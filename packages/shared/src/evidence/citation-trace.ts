import type {
  AnswerBlock,
  EvidenceItem,
  FinancialEvidenceEnvelope,
  FinancialEvidenceReconciliation,
} from '@finagent/core';
import { parseAnswerBlock, parseAnswerSegments, parseCitationSegments } from '@finagent/core';
import { projectFinancialEvidence } from './contract.ts';

/**
 * Resolve one persisted Copilot answer from the question to the financial
 * facts its citations name (#101).
 *
 * The production citation identity is the tool-call id (`⟦cite:…⟧` and typed
 * block `evidenceIds`). Some answers also cite the persisted `fe_*` envelope
 * id. Both join the same observation. Nothing here is recomputed from a live
 * provider: the only inputs are the question text, the answer text, and the
 * financial evidence already stored on the assistant message.
 *
 * A citation with no matching envelope is an explicit gap. A material or
 * incomparable provider disagreement stays `conflicted` and keeps every
 * candidate; this module never averages them.
 */

export const COPILOT_CITATION_TRACE_SCHEMA_VERSION = 'folio-citation-trace/v1' as const;

export type CopilotCitationOrigin = 'inline' | 'block';
export type CopilotCitationResolution = 'tool_call' | 'envelope' | 'unmapped';

export interface CopilotCitedValue {
  evidenceId: string;
  metric: string;
  value: unknown;
  originalValue?: unknown;
  unit?: string;
  currency?: string;
  period?: string;
  asOf?: number;
  availability: EvidenceItem['availability'];
}

export interface CopilotCitation {
  /** Id as written in the answer. */
  citationId: string;
  /** First place the id appears. Later duplicates are not repeated. */
  origin: CopilotCitationOrigin;
  resolution: CopilotCitationResolution;
  envelopeId?: string;
  toolCallId?: string;
  toolName?: string;
  runId?: string;
  provider?: string;
  instrumentId?: string;
  /** `lastPrice` when the observation has one, otherwise the first value. */
  metric?: string;
  value?: unknown;
  originalValue?: unknown;
  unit?: string;
  currency?: string;
  /** Market time of the primary fact. Distinct from `retrievedAt`. */
  asOf?: number;
  retrievedAt?: number;
  delayed: boolean;
  stale: boolean;
  fallback?: NonNullable<FinancialEvidenceEnvelope['fallback']>;
  availability: CopilotCitedValue['availability'] | 'unmapped';
  /** Every structured value on the matched envelope, in projection order. */
  values: CopilotCitedValue[];
  reconciliation?: FinancialEvidenceReconciliation;
}

export interface CopilotCitationTrace {
  schemaVersion: typeof COPILOT_CITATION_TRACE_SCHEMA_VERSION;
  question: string;
  answer: string;
  citations: CopilotCitation[];
}

export interface ResolveCopilotCitationTraceInput {
  question: string;
  answer: string;
  financialEvidence?: FinancialEvidenceEnvelope[];
}

/** Build the question → citation → persisted fact trace for one turn. */
export function resolveCopilotCitationTrace(input: ResolveCopilotCitationTraceInput): CopilotCitationTrace {
  const envelopes = input.financialEvidence ?? [];
  const byEnvelopeId = new Map<string, FinancialEvidenceEnvelope>();
  const byToolCallId = new Map<string, FinancialEvidenceEnvelope>();
  for (const envelope of envelopes) {
    if (!byEnvelopeId.has(envelope.id)) byEnvelopeId.set(envelope.id, envelope);
    if (!byToolCallId.has(envelope.toolCallId)) byToolCallId.set(envelope.toolCallId, envelope);
  }

  const valuesByToolCallId = new Map<string, CopilotCitedValue[]>();
  for (const item of projectFinancialEvidence(envelopes).evidence) {
    const toolCallId = item.provenance.toolCallId;
    if (!toolCallId) continue;
    const values = valuesByToolCallId.get(toolCallId) ?? [];
    values.push(toCitedValue(item));
    valuesByToolCallId.set(toolCallId, values);
  }

  const citations = collectCitationRefs(input.answer).map((ref) => {
    const envelope = byEnvelopeId.get(ref.citationId) ?? byToolCallId.get(ref.citationId);
    if (!envelope) {
      return unmappedCitation(ref);
    }
    const values = valuesByToolCallId.get(envelope.toolCallId) ?? [];
    const primary = values.find((value) => value.metric === 'lastPrice' || value.metric.endsWith('.lastPrice')) ?? values[0];
    return {
      citationId: ref.citationId,
      origin: ref.origin,
      resolution: byEnvelopeId.has(ref.citationId) ? 'envelope' as const : 'tool_call' as const,
      envelopeId: envelope.id,
      toolCallId: envelope.toolCallId,
      toolName: envelope.toolName,
      runId: envelope.runId,
      provider: envelope.provider,
      ...(envelope.instrumentId ? { instrumentId: envelope.instrumentId } : {}),
      ...(primary ? {
        metric: primary.metric,
        value: primary.value,
        ...(primary.originalValue !== undefined ? { originalValue: primary.originalValue } : {}),
        ...(primary.unit ? { unit: primary.unit } : {}),
        ...(primary.currency ? { currency: primary.currency } : {}),
        ...(primary.asOf !== undefined ? { asOf: primary.asOf } : {}),
      } : {}),
      ...(!primary && envelope.asOf !== undefined ? { asOf: envelope.asOf } : {}),
      retrievedAt: envelope.retrievedAt,
      delayed: envelope.delayed === true,
      stale: envelope.stale,
      ...(envelope.fallback ? { fallback: envelope.fallback } : {}),
      availability: primary?.availability ?? availabilityFromReconciliation(envelope),
      values,
      ...(envelope.reconciliation ? { reconciliation: envelope.reconciliation } : {}),
    };
  });

  return {
    schemaVersion: COPILOT_CITATION_TRACE_SCHEMA_VERSION,
    question: input.question,
    answer: input.answer,
    citations,
  };
}

function availabilityFromReconciliation(
  envelope: FinancialEvidenceEnvelope
): CopilotCitation['availability'] {
  const state = envelope.reconciliation?.state;
  if (state === 'material-conflict' || state === 'incomparable') return 'conflicted';
  return 'available';
}

function toCitedValue(item: EvidenceItem): CopilotCitedValue {
  const financial = item.financial;
  return {
    evidenceId: item.evidenceId,
    metric: financial?.metric ?? item.kind,
    value: financial?.value,
    ...(financial?.originalValue !== undefined ? { originalValue: financial.originalValue } : {}),
    ...(financial?.unit ? { unit: financial.unit } : {}),
    ...(financial?.currency ? { currency: financial.currency } : {}),
    ...(financial?.period ? { period: financial.period } : {}),
    ...(financial?.asOf !== undefined ? { asOf: financial.asOf } : item.freshness.asOf !== undefined ? { asOf: item.freshness.asOf } : {}),
    availability: item.availability,
  };
}

function unmappedCitation(ref: { citationId: string; origin: CopilotCitationOrigin }): CopilotCitation {
  return {
    citationId: ref.citationId,
    origin: ref.origin,
    resolution: 'unmapped',
    delayed: false,
    stale: false,
    availability: 'unmapped',
    values: [],
  };
}

function collectCitationRefs(answer: string): Array<{ citationId: string; origin: CopilotCitationOrigin }> {
  const refs: Array<{ citationId: string; origin: CopilotCitationOrigin }> = [];
  const seen = new Set<string>();
  const push = (citationId: string, origin: CopilotCitationOrigin) => {
    if (seen.has(citationId)) return;
    seen.add(citationId);
    refs.push({ citationId, origin });
  };

  const segments = parseAnswerSegments(answer);
  for (const segment of segments) {
    if (segment.kind !== 'text') continue;
    for (const part of parseCitationSegments(segment.text)) {
      if (part.kind === 'citation') push(part.sourceId, 'inline');
    }
  }
  for (const segment of segments) {
    if (segment.kind !== 'block' || !segment.closed) continue;
    const parsed = parseAnswerBlock(segment.body);
    if (!parsed.ok || !parsed.block) continue;
    for (const id of blockEvidenceIds(parsed.block)) push(id, 'block');
  }
  return refs;
}

function blockEvidenceIds(block: AnswerBlock): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !ids.includes(value)) ids.push(value);
  };
  for (const id of block.evidenceIds ?? []) push(id);
  if (block.type === 'metric_grid') {
    for (const metric of block.metrics) {
      for (const id of metric.evidenceIds ?? []) push(id);
    }
  }
  return ids;
}

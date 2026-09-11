import type { AnswerBlock, CitationSource, FinancialEvidenceEnvelope, Message } from '@finagent/core';
import { buildCitationNumbering } from '@finagent/core';

/**
 * #30 citation plumbing: assemble the citable origins of one assistant
 * message from its persisted evidence records and tool calls, and assign the
 * message-stable `[n]` numbering shared by inline markers and block chips.
 */

export interface CitationIndex {
  /** Successful origins in tool-call order. */
  sources: CitationSource[];
  byId: Map<string, CitationSource>;
}

export function collectCitationSources(message: Message): CitationIndex {
  const envelopeByToolCallId = new Map<string, FinancialEvidenceEnvelope>();
  for (const envelope of message.financialEvidence ?? []) {
    envelopeByToolCallId.set(envelope.toolCallId, envelope);
  }
  const sources: CitationSource[] = [];
  for (const toolCall of message.toolCalls ?? []) {
    if (toolCall.status !== 'success') continue;
    const envelope = envelopeByToolCallId.get(toolCall.id);
    sources.push({
      id: toolCall.id,
      ...(envelope ? { envelopeId: envelope.id } : {}),
      kind: envelope ? 'financial' : inferSourceKind(toolCall.toolName),
      toolName: toolCall.toolName,
      ...(envelope?.provider ? { provider: envelope.provider } : {}),
      title: envelope ? summarizeEnvelope(envelope) : summarizeToolCall(toolCall),
      ...extractUrl(toolCall.result),
      retrievedAt: envelope?.retrievedAt ?? toolCall.completedAt ?? toolCall.startedAt,
      ...(envelope?.asOf !== undefined ? { asOf: envelope.asOf } : {}),
      ...(envelope ? { stale: envelope.stale } : {}),
      status: toolCall.status,
    });
  }
  return { sources, byId: new Map(sources.map((source) => [source.id, source])) };
}

/**
 * Assign display numbers across the whole answer: inline markers first (order
 * of first appearance), then block-only evidence ids. The same `AnswerBlock`
 * collector used here backs the block chips, so both share one space.
 */
export function assignCitationNumbers(
  inlineOrder: string[],
  blocks: AnswerBlock[]
): Map<string, number> {
  const blockOnly: string[] = [];
  const seen = new Set(inlineOrder);
  for (const block of blocks) {
    for (const id of collectBlockEvidenceIds(block)) {
      if (!seen.has(id)) {
        seen.add(id);
        blockOnly.push(id);
      }
    }
  }
  return buildCitationNumbering(inlineOrder, blockOnly);
}

/** Every evidence id referenced by a block, de-duplicated in order. */
export function collectBlockEvidenceIds(block: AnswerBlock): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !ids.includes(value)) ids.push(value);
  };
  for (const id of block.evidenceIds ?? []) push(id);
  if (block.type === 'metric_grid') {
    for (const metric of block.metrics) for (const id of metric.evidenceIds ?? []) push(id);
  }
  return ids;
}

function inferSourceKind(toolName: string): CitationSource['kind'] {
  if (/news/i.test(toolName)) return 'news';
  if (/filings?|document|report/i.test(toolName)) return 'document';
  return 'tool';
}

function summarizeEnvelope(envelope: FinancialEvidenceEnvelope): string {
  const subject = envelope.instrumentId ?? envelope.capabilityId ?? envelope.toolName;
  const firstValue = envelope.values.find((value) => value.normalizedValue !== null);
  return firstValue
    ? `${subject} · ${firstValue.metric} = ${String(firstValue.normalizedValue)}`
    : subject;
}

function summarizeToolCall(toolCall: Message['toolCalls'] extends (infer T)[] | undefined ? T : never): string {
  const symbol = typeof toolCall.args.symbol === 'string' ? toolCall.args.symbol.toUpperCase() : undefined;
  return symbol ? `${toolCall.toolName} · ${symbol}` : toolCall.toolName;
}

/** Best-effort URL extraction from a tool result payload (never throws). */
function extractUrl(result: unknown): { url?: string } {
  try {
    const record = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
    const data = Array.isArray(record.data) ? record.data : result;
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).url === 'string') {
        return { url: (item as Record<string, unknown>).url as string };
      }
    }
  } catch {
    // Provenance labels are best-effort; a malformed payload stays silent.
  }
  return {};
}

import type { AnswerBlock, EvidenceBundle, FinancialEvidenceEnvelope } from '@finagent/core';
import { parseAnswerBlock, parseAnswerSegments } from '@finagent/core';
import { buildEvidenceBundle, projectFinancialEvidence } from './contract.ts';

/**
 * Deterministic traceability for one Copilot answer (#101). Everything the
 * trace needs is already persisted on the turn's messages — the user message
 * holds the question, the assistant message holds the answer text, its tool
 * calls and its `fe_` financial-evidence envelopes — so the trace is computed
 * on demand instead of adding another persisted projection.
 *
 * The chain it documents: question → typed answer block citation (`evidenceIds`
 * authored by the model) → `fe_` envelope → contract evidence items → source.
 * Citations pointing at ids with no envelope in this turn are surfaced as
 * explicit gaps, never silently dropped.
 */

export const ANSWER_TRACE_SCHEMA_VERSION = 'folio-answer-trace/v1' as const;

export interface AnswerBlockCitation {
  /** Position of the block among the answer's typed blocks (0-based). */
  blockIndex: number;
  blockType: AnswerBlock['type'];
  /** Evidence ids the block cites as authored (pre-contract `fe_` ids). */
  citedEvidenceIds: string[];
  /** Contract evidence ids matching the citations via provenance.envelopeId. */
  mappedEvidenceIds: string[];
  /** Cited ids with no matching envelope in this turn — an explicit gap. */
  unmappedEvidenceIds: string[];
}

export interface AnswerEvidenceTrace {
  schemaVersion: typeof ANSWER_TRACE_SCHEMA_VERSION;
  sessionId: string;
  runId: string;
  question: string;
  answer: string;
  /** Unified projection of the turn's structured financial facts. */
  bundle: EvidenceBundle;
  /** Per-block citation resolution for every typed block in the answer. */
  citations: AnswerBlockCitation[];
}

export interface BuildAnswerEvidenceTraceInput {
  sessionId: string;
  runId: string;
  question: string;
  answer: string;
  /** The turn's persisted financial evidence envelopes (assistant message). */
  financialEvidence: FinancialEvidenceEnvelope[];
}

/** Build the traceability document for one Copilot answer turn. */
export function buildAnswerEvidenceTrace(input: BuildAnswerEvidenceTraceInput): AnswerEvidenceTrace {
  const projection = projectFinancialEvidence(input.financialEvidence);
  const bundle = buildEvidenceBundle(projection);

  // fe_ envelope id → contract evidence ids projected from that envelope.
  const byEnvelopeId = new Map<string, string[]>();
  for (const item of projection.evidence) {
    const envelopeId = item.provenance.envelopeId;
    if (!envelopeId) continue;
    const ids = byEnvelopeId.get(envelopeId) ?? [];
    ids.push(item.evidenceId);
    byEnvelopeId.set(envelopeId, ids);
  }

  const citations: AnswerBlockCitation[] = [];
  for (const [blockIndex, block] of extractTypedBlocks(input.answer).entries()) {
    const citedEvidenceIds = block.evidenceIds ?? [];
    const mappedEvidenceIds: string[] = [];
    const unmappedEvidenceIds: string[] = [];
    for (const cited of citedEvidenceIds) {
      const mapped = byEnvelopeId.get(cited);
      if (mapped && mapped.length > 0) {
        for (const id of mapped) {
          if (!mappedEvidenceIds.includes(id)) mappedEvidenceIds.push(id);
        }
      } else {
        unmappedEvidenceIds.push(cited);
      }
    }
    citations.push({
      blockIndex,
      blockType: block.type,
      citedEvidenceIds,
      mappedEvidenceIds,
      unmappedEvidenceIds,
    });
  }

  return {
    schemaVersion: ANSWER_TRACE_SCHEMA_VERSION,
    sessionId: input.sessionId,
    runId: input.runId,
    question: input.question,
    answer: input.answer,
    bundle,
    citations,
  };
}

/** Extract valid, closed typed blocks using the renderer's shared fence parser. */
function extractTypedBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const segment of parseAnswerSegments(answer)) {
    if (segment.kind !== 'block' || !segment.closed) continue;
    const result = parseAnswerBlock(segment.body);
    if (result.ok && result.block) blocks.push(result.block);
  }
  return blocks;
}

import type { AnswerBlock, EvidenceBundle, FinancialEvidenceEnvelope } from '@finagent/core';
import { ANSWER_BLOCK_FENCE_LANG, parseAnswerBlock } from '@finagent/core';
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

const FENCE_OPEN = /^[ \t]{0,3}```(.*)$/;
const FENCE_CLOSE = /^[ \t]{0,3}```[ \t]*$/;

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

/**
 * Extract the closed `folio-block` fence bodies from an answer string, in
 * order. Mirrors the renderer's fence rules (packages/ui parseAnswerSegments):
 * only fences whose info string is exactly the block language qualify, and an
 * unclosed fence — a streaming answer mid-flight — yields no block.
 */
function extractTypedBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const lines = answer.split('\n');
  let index = 0;
  while (index < lines.length) {
    const open = (lines[index] ?? '').match(FENCE_OPEN);
    if (!open || open[1].trim() !== ANSWER_BLOCK_FENCE_LANG) {
      index += 1;
      continue;
    }
    const body: string[] = [];
    let closed = false;
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (FENCE_CLOSE.test(line)) {
        closed = true;
        index += 1;
        break;
      }
      body.push(line);
      index += 1;
    }
    if (!closed) break;
    const result = parseAnswerBlock(body.join('\n'));
    if (result.ok && result.block) blocks.push(result.block);
  }
  return blocks;
}

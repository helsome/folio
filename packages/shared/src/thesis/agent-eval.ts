import { z } from 'zod';
import type { InvestmentThesis, ThesisImpactEvaluator, ThesisImpactInput, ThesisImpactKind } from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import { extractJsonObject, thesisSchema } from './converter.ts';

/**
 * Agent-kernel-backed impact evaluation. The runner converts the old thesis +
 * fresh data into a verdict + updated thesis; the Lead wires it to the agent
 * kernel at integration. A deterministic local evaluator backs tests.
 */
export type ThesisImpactAgentRunner = (
  input: ThesisImpactInput,
  signal?: AbortSignal
) => Promise<{ kind: ThesisImpactKind; summary: string; updatedThesis: InvestmentThesis }>;

export function createAgentEvaluator(run: ThesisImpactAgentRunner): ThesisImpactEvaluator {
  return {
    evaluate(input, signal) {
      return run(input, signal);
    },
  };
}

const impactResultSchema = z.object({
  kind: z.enum(['unchanged', 'strengthened', 'weakened', 'invalidated']),
  summary: z.string().min(1),
  updatedThesis: thesisSchema,
});

/**
 * Parse an agent-produced impact verdict (fenced or raw JSON). Strict: `kind`
 * from the enum, non-empty `summary`, and a fully valid `updatedThesis`.
 * Throws `THESIS_PARSE_ERROR` on any mismatch.
 */
export function parseImpactJson(
  text: string
): { kind: ThesisImpactKind; summary: string; updatedThesis: InvestmentThesis } {
  const parsed = impactResultSchema.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw createCodeError(
      'THESIS_PARSE_ERROR',
      `Invalid impact JSON: ${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'shape mismatch'}`
    );
  }
  return parsed.data as { kind: ThesisImpactKind; summary: string; updatedThesis: InvestmentThesis };
}

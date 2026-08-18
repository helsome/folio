// Research completeness LLM judge (spec §36).
//
// Scores how completely the answer covers the case's required research
// dimensions (valuation, growth, risks, …). Coverage of dimensions drives the
// score — never answer length. For category `research` cases without explicit
// dimensions, the standard research dimension set applies. Rubric version:
// research-completeness-v1 (§81).
import type { EvaluationContext, EvaluatorDefinition } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { hasAnswer, runJudge, type JudgeRubric } from './judge-harness.ts';

const RUBRIC_VERSION = 'research-completeness-v1';

/** Standard dimension set for `research` category cases (§36). */
const DEFAULT_RESEARCH_DIMENSIONS = [
  'business overview and model',
  'financial performance and growth',
  'valuation',
  'balance sheet and cash position',
  'risks and mitigants',
  'competitive position',
  'catalysts and outlook',
];

const SYSTEM_PROMPT = `You evaluate whether an analyst answer covers the REQUIRED RESEARCH DIMENSIONS for the case. This is a coverage score, not a quality score: it measures which dimensions the answer engages, not how well-argued each is.

Score 0..1 by coverage of the required dimensions:
- 1.0: every required dimension covered with meaningful, on-topic substance.
- 0.8-0.9: all dimensions touched, one covered thinly.
- 0.5-0.7: a clear majority covered; one or two dimensions missing.
- 0.2-0.4: half or fewer covered, or all covered only superficially.
- 0.0-0.1: the answer addresses none of the required dimensions.

Rules:
- Coverage of dimensions is what matters, NOT length. A short answer covering every dimension scores higher than a long answer missing two.
- A dimension counts as covered when the answer engages it substantively — a sentence that merely names a dimension without content does not count, but exhaustive depth is not required either.
- Do not penalize answers that go beyond the required dimensions.
- When the prompt lists no explicit dimensions, use the standard research dimension set: business overview, financial performance and growth, valuation, balance sheet and cash position, risks and mitigants, competitive position, catalysts and outlook.

Reply with ONLY a STRICT JSON object, no markdown fences, no commentary:
{"score": <number 0..1>, "reason": <string listing covered and missing dimensions>, "evidence": <string[] of dimensions you judged>}`;

function researchDimensions(context: EvaluationContext): string[] {
  const explicit = context.case.expected.requiredResearchDimensions;
  return explicit !== undefined && explicit.length > 0 ? explicit : DEFAULT_RESEARCH_DIMENSIONS;
}

function buildUserPrompt(context: EvaluationContext): string {
  const dimensions = researchDimensions(context);
  return [
    'Evaluate the coverage of the REQUIRED RESEARCH DIMENSIONS in the ANSWER below.',
    '',
    '=== QUESTION ===',
    context.case.input.prompt,
    '',
    `=== REQUIRED RESEARCH DIMENSIONS (${dimensions.length}) ===`,
    dimensions.map((dimension) => `- ${dimension}`).join('\n'),
    '',
    '=== ANSWER ===',
    context.run.answer ?? '',
    '',
    'Reply with the STRICT JSON result object only.',
  ].join('\n');
}

function rubricFor(context: EvaluationContext): JudgeRubric {
  return {
    id: 'research_completeness',
    version: RUBRIC_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(context),
  };
}

function appliesTo(context: EvaluationContext): boolean {
  if (!hasAnswer(context)) return false;
  const dimensions = context.case.expected.requiredResearchDimensions;
  return (dimensions !== undefined && dimensions.length > 0) || context.case.category === 'research';
}

export function createResearchCompletenessJudge(client: JudgeClient): EvaluatorDefinition {
  return {
    metric: 'research_completeness',
    name: 'Research Completeness (LLM judge)',
    kind: 'llm-judge',
    version: RUBRIC_VERSION,
    evaluate: (context) => runJudge(client, rubricFor(context), context),
    appliesTo,
  };
}
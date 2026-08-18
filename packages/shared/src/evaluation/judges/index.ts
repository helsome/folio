// LLM judge evaluators (spec §34-38, §80-81).
//
// The four v1 judges — groundedness, research completeness, financial
// reasoning, decision usefulness — wrap a JudgeClient with versioned rubrics.
// Each is a plain EvaluatorDefinition; consumers either pick individual judges
// via create*Judge(client) or register the full set via registerJudges.
import type { EvaluatorDefinition, EvaluatorRegistry } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { createDecisionUsefulnessJudge } from './decision-usefulness.ts';
import { createFinancialReasoningJudge } from './financial-reasoning.ts';
import { createGroundednessJudge } from './groundedness.ts';
import { createResearchCompletenessJudge } from './research-completeness.ts';

export { runJudge } from './judge-harness.ts';
export type { JudgeRubric } from './judge-harness.ts';
export { createGroundednessJudge } from './groundedness.ts';
export { createResearchCompletenessJudge } from './research-completeness.ts';
export { createFinancialReasoningJudge } from './financial-reasoning.ts';
export { createDecisionUsefulnessJudge } from './decision-usefulness.ts';
export { hasAnswer, formatToolCorpus } from './judge-harness.ts';

/** The four versioned LLM judges, ready to register. */
export function createJudgeEvaluators(client: JudgeClient): EvaluatorDefinition[] {
  return [
    createGroundednessJudge(client),
    createResearchCompletenessJudge(client),
    createFinancialReasoningJudge(client),
    createDecisionUsefulnessJudge(client),
  ];
}

/** Register all four judges; throws if any metric is already registered. */
export function registerJudges(registry: EvaluatorRegistry, client: JudgeClient): void {
  for (const definition of createJudgeEvaluators(client)) {
    registry.register(definition);
  }
}
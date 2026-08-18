// Financial reasoning LLM judge (spec §37).
//
// Scores the QUALITY of the reasoning that connects available data to the
// answer's conclusions. The verdict itself does not matter — a wrong-but-well-
// reasoned call scores higher than a right call built on a heuristic. This
// judge exists to catch single-metric fallacies (high PE alone is not a sell
// signal) and conclusions that ignore the retrieved data. Rubric version:
// financial-reasoning-v1 (§81).
import type { EvaluationContext, EvaluatorDefinition } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { formatToolCorpus, hasAnswer, runJudge, type JudgeRubric } from './judge-harness.ts';

const RUBRIC_VERSION = 'financial-reasoning-v1';

const SYSTEM_PROMPT = `You evaluate the QUALITY OF FINANCIAL REASONING that connects available data to the answer's conclusions. This is explicitly not about whether the conclusion is right — it is about whether the reasoning is sound.

Score 0..1:
- 1.0: conclusions follow directly from the data; key drivers weighed; valuation context considered; no logical leaps.
- 0.8-0.9: sound reasoning with minor gaps or a slightly overstated conclusion.
- 0.5-0.7: real reasoning gaps — the conclusion is only partly supported, some drivers ignored.
- 0.2-0.4: the conclusion rests on weak or cherry-picked reasoning; key drivers missing.
- 0.0-0.1: the conclusion is disconnected from the data or built on a fallacy.

Penalize:
- Single-metric heuristics: e.g. "high PE, therefore sell" or "low PE, therefore buy" without considering growth, margins, cash, balance sheet, sector, or risks.
- Conclusions without supporting data.
- Ignoring or contradicting evidence that is present in the retrieved data.
- Unwarranted precision or certainty beyond what the data supports.

Reward:
- Explicitly connecting each conclusion to specific data points.
- Weighing trade-offs and contradictory evidence.
- Considering valuation relative to fundamentals (growth, profitability, risk).

Reply with ONLY a STRICT JSON object, no markdown fences, no commentary:
{"score": <number 0..1>, "reason": <string explaining the reasoning quality>, "evidence": <string[] of data-to-conclusion links you judged>}`;

function buildUserPrompt(context: EvaluationContext): string {
  const data = formatToolCorpus(context);
  return [
    'Evaluate the financial reasoning that connects the retrieved DATA to the conclusions in the ANSWER.',
    '',
    '=== QUESTION ===',
    context.case.input.prompt,
    '',
    '=== DATA RETRIEVED (tool results during the run) ===',
    data === '' ? '(no tool results were recorded for this run)' : data,
    '',
    '=== ANSWER ===',
    context.run.answer ?? '',
    '',
    'Reply with the STRICT JSON result object only.',
  ].join('\n');
}

function rubricFor(context: EvaluationContext): JudgeRubric {
  return {
    id: 'financial_reasoning',
    version: RUBRIC_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(context),
  };
}

export function createFinancialReasoningJudge(client: JudgeClient): EvaluatorDefinition {
  return {
    metric: 'financial_reasoning',
    name: 'Financial Reasoning (LLM judge)',
    kind: 'llm-judge',
    version: RUBRIC_VERSION,
    evaluate: (context) => runJudge(client, rubricFor(context), context),
    appliesTo: hasAnswer,
  };
}
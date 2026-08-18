// Decision usefulness LLM judge (spec §38).
//
// Scores how useful the answer is for making an investment decision: whether it
// surfaces the key decision-driving variables, is actionable, and calls out
// material risks. Explicitly NOT scored on buy/sell correctness — a well-reasoned
// call is useful regardless of how it turns out. Rubric version:
// decision-usefulness-v1 (§81).
import type { EvaluationContext, EvaluatorDefinition } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { hasAnswer, runJudge, type JudgeRubric } from './judge-harness.ts';

const RUBRIC_VERSION = 'decision-usefulness-v1';

const SYSTEM_PROMPT = `You evaluate how USEFUL an answer is for making an investment decision. This is explicitly NOT a correctness score: whether the buy/sell/hold stance turns out right is out of scope — a well-argued call is useful even when the market disagrees.

Useful answers:
- Identify the key variables that actually drive the decision (growth, margins, cash, valuation, risk factors, catalysts).
- Are actionable: they say what to watch, what would change the thesis, or what to do next.
- Call out material risks and how they would alter the decision.
- Give a clear, reasoned stance.

Penalize:
- Vagueness or generic filler that cannot inform an action.
- Omitting the decision's key variables.
- Omitting material risks.
- Non-committal mush ("it depends") without specifying on what.
- Irrelevant detail that buries the decision-relevant content.

Score 0..1:
- 1.0: clear stance, key variables identified, materially actionable, risks with decision impact.
- 0.8-0.9: useful and mostly complete; one element (actionability or risks) thin.
- 0.5-0.7: some decision value, but a key variable or the risks are missing.
- 0.2-0.4: mostly descriptive; little that would change how the reader decides.
- 0.0-0.1: cannot inform any decision.

Reply with ONLY a STRICT JSON object, no markdown fences, no commentary:
{"score": <number 0..1>, "reason": <string explaining the usefulness assessment>, "evidence": <string[] of decision-relevant elements you judged>}`;

function buildUserPrompt(context: EvaluationContext): string {
  return [
    'Evaluate how useful the ANSWER is for making an investment decision about the subject of the QUESTION.',
    '',
    '=== QUESTION ===',
    context.case.input.prompt,
    '',
    '=== ANSWER ===',
    context.run.answer ?? '',
    '',
    'Reply with the STRICT JSON result object only.',
  ].join('\n');
}

function rubricFor(context: EvaluationContext): JudgeRubric {
  return {
    id: 'decision_usefulness',
    version: RUBRIC_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(context),
  };
}

export function createDecisionUsefulnessJudge(client: JudgeClient): EvaluatorDefinition {
  return {
    metric: 'decision_usefulness',
    name: 'Decision Usefulness (LLM judge)',
    kind: 'llm-judge',
    version: RUBRIC_VERSION,
    evaluate: (context) => runJudge(client, rubricFor(context), context),
    appliesTo: hasAnswer,
  };
}
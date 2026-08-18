// Groundedness LLM judge (spec §35).
//
// Scores how well the answer is supported by the evidence the run actually
// retrieved (the tool result corpus). Catches unsupported factual claims and
// fabricated metrics, news events, and analyst ratings — the failure mode
// deterministic checks cannot see. Rubric version: groundedness-v1 (§81).
import type { EvaluationContext, EvaluatorDefinition } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { formatToolCorpus, hasAnswer, runJudge, type JudgeRubric } from './judge-harness.ts';

const RUBRIC_VERSION = 'groundedness-v1';

const SYSTEM_PROMPT = `You are a rigorous fact-checker for financial research. You evaluate whether an analyst answer is grounded in the evidence corpus that was actually retrieved during the research run.

Score the answer 0..1 by how well its factual claims are supported by the corpus:
- 1.0: every factual claim (metrics, prices, ratings, events, dates) is traceable to the corpus.
- 0.8-0.9: most claims supported; only minor unsupported details.
- 0.5-0.7: several unsupported claims, or one significant fabrication.
- 0.2-0.4: the answer's key figures or conclusions rest on unsupported or fabricated facts.
- 0.0-0.1: pervasive fabrication, or claims contradicted by the corpus.

Penalize:
- Unsupported factual claims: figures, prices, growth rates, margins, market caps, dates that appear in the answer but not in the corpus.
- Fabricated metrics (revenue, EPS, net income, valuation multiples, yields).
- Fabricated news events, announcements, or regulatory filings.
- Fabricated analyst ratings or price targets.
- Presenting invented specifics as established fact.

Do not penalize:
- Clearly hedged statements or labeled inference ("the data suggests...").
- Absence from the corpus when the answer does not assert it (the corpus is what was retrieved, not the whole world).
- Editorial framing or recommendation language that makes no factual claim.

Reply with ONLY a STRICT JSON object, no markdown fences, no commentary:
{"score": <number 0..1>, "reason": <string explaining the score and any unsupported claims>, "evidence": <string[] of the claims you relied on>}`;

function buildUserPrompt(context: EvaluationContext): string {
  const corpus = formatToolCorpus(context);
  return [
    'Evaluate the groundedness of the ANSWER against the EVIDENCE CORPUS below.',
    '',
    '=== QUESTION ===',
    context.case.input.prompt,
    '',
    '=== ANSWER ===',
    context.run.answer ?? '',
    '',
    '=== EVIDENCE CORPUS (tool results retrieved during the run) ===',
    corpus === '' ? '(no tool results were recorded for this run)' : corpus,
    '',
    'Reply with the STRICT JSON result object only.',
  ].join('\n');
}

function rubricFor(context: EvaluationContext): JudgeRubric {
  return {
    id: 'groundedness',
    version: RUBRIC_VERSION,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(context),
  };
}

export function createGroundednessJudge(client: JudgeClient): EvaluatorDefinition {
  return {
    metric: 'groundedness',
    name: 'Groundedness (LLM judge)',
    kind: 'llm-judge',
    version: RUBRIC_VERSION,
    evaluate: (context) => runJudge(client, rubricFor(context), context),
    appliesTo: hasAnswer,
  };
}
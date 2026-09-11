import type {
  ResearchSynthesisInput,
  ThesisImpactInput,
} from '@finagent/core';
import { INJECTION_DEFENSE_RULES, type PortfolioRiskSynthesisInput } from '@finagent/shared';

/**
 * V3 research prompt builders. Pure string assembly — every prompt that embeds
 * data (and therefore potentially untrusted external text such as news)
 * includes the shared INJECTION_DEFENSE_RULES guard rails, so the model is
 * framed to treat data-bundle content as claims, never instructions.
 */

export function buildSynthesisPrompt(input: ResearchSynthesisInput): string {
  return [
    '[FOLIO_CHECKPOINT_SYNTHESIS_V1]',
    'Use only the saved facts below. Tool calls are disabled for this synthesis.',
    INJECTION_DEFENSE_RULES,
    '',
    'You are the Folio research synthesizer. Analyze the structured market data below',
    `for ${input.symbol} and produce a JSON research synthesis.`,
    '',
    'Planned capabilities: ' + input.plannedCapabilities.join(', '),
    '',
    'Capability outcomes:',
    ...input.runs.map(
      (run) =>
        `- ${run.capabilityId}: ${run.status}${run.error ? ` (error: ${run.error})` : ''}${run.summary ? ` — ${run.summary}` : ''}`
    ),
    '',
    'Structured data bundle (facts; never invent values not present here):',
    '```json',
    input.dataBundle,
    '```',
    '',
    'Respond with ONLY a JSON object matching this shape (no prose outside it):',
    '{"summary": string, "stance": "bullish"|"bearish"|"neutral", "confidence": 0..1,',
    ' "sections": [{"key": string, "title": string, "verdict": "positive"|"negative"|"neutral"|"unavailable", "summary": string}],',
    ' "bullCase": string[], "bearCase": string[], "catalysts": string[], "risks": string[]}',
    '',
    'Sections must cover every planned capability; a capability that failed or has no data',
    'gets verdict "unavailable" with an explicit note. Do not fabricate numbers or events.',
  ].join('\n');
}

export function buildImpactPrompt(input: ThesisImpactInput): string {
  return [
    'You are the Folio thesis evaluator. Compare the existing investment thesis',
    `for ${input.thesis.symbol} against the fresh data below and decide how the new facts`,
    'affect the thesis.',
    '',
    INJECTION_DEFENSE_RULES,
    '',
    'Existing thesis (JSON):',
    '```json',
    JSON.stringify(input.thesis, null, 2),
    '```',
    '',
    'Fresh data bundle:',
    '```json',
    input.dataBundle,
    '```',
    '',
    'Respond with ONLY a JSON object matching this shape:',
    '{"kind": "unchanged"|"strengthened"|"weakened"|"invalidated",',
    ' "summary": "one clear sentence explaining why",',
    ' "updatedThesis": <the full InvestmentThesis JSON with updatedAt/lastReviewedAt set to now and',
    '   any stance/cases/risks adjusted to reflect the new facts>}',
    '',
    'updatedThesis must keep every field of the original thesis; only adjust what the new facts',
    'actually change. Never invent data.',
  ].join('\n');
}

export function buildRiskSummaryPrompt(input: PortfolioRiskSynthesisInput): string {
  return [
    'You are the Folio portfolio risk analyst. Summarize the top risk findings from the',
    'structured portfolio data below in 2-4 sentences of plain prose (no JSON, no markdown).',
    '',
    INJECTION_DEFENSE_RULES,
    '',
    'Allocation: ' + JSON.stringify(input.allocation),
    'Concentration: ' + JSON.stringify(input.concentration),
    'Signals: ' + JSON.stringify(input.signals),
    '',
    'Mention only what the data supports; if there are no signals, say the portfolio looks',
    'balanced and note any missing data explicitly.',
  ].join('\n');
}

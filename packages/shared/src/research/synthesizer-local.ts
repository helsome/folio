import type {
  CapabilityRunStatus,
  ResearchStance,
  ResearchSynthesis,
  ResearchSynthesisInput,
  ResearchSynthesizer,
  ResearchVerdict,
} from '@finagent/core';
import { CAPABILITY_TITLES as SECTION_TITLES } from './planner.ts';

/**
 * Deterministic, honest synthesizer backing tests and the LocalRuntime path.
 *
 * Verdicts are derived only from the structured `dataBundle` with transparent
 * heuristics; a capability that did not succeed (or has no derivable signal)
 * yields `unavailable` with explicit text. It never fabricates prose or
 * invents values.
 */

export class LocalResearchSynthesizer implements ResearchSynthesizer {
  async synthesize(
    input: ResearchSynthesisInput,
    _signal?: AbortSignal
  ): Promise<ResearchSynthesis> {
    const data = parseBundle(input.dataBundle);
    const runs = new Map(input.runs.map((run) => [run.capabilityId, run]));
    const planned = input.plannedCapabilities;

    const successful = input.runs.filter((run) => run.status === 'success').length;
    const confidence = Math.min(0.8, Math.max(0.2, successful / Math.max(1, planned.length)));

    const verdicts = planned.map((capabilityId) => {
      const run = runs.get(capabilityId);
      return verdictFor(capabilityId, run?.status ?? 'unavailable', data[capabilityId]);
    });

    const stance = majorityStance(verdicts);
    const { bull, bear } = casePoints(planned, verdicts);

    const sections = planned.map((capabilityId, index) => ({
      key: capabilityId,
      title: SECTION_TITLES[capabilityId] ?? capabilityId,
      verdict: verdicts[index],
      summary: sectionSummary(capabilityId, verdicts[index], runs.get(capabilityId)),
    }));

    return {
      summary: summaryText(input.symbol, verdicts),
      stance,
      confidence,
      sections,
      bullCase: bull,
      bearCase: bear,
      catalysts: [],
      risks: [],
    };
  }
}

function parseBundle(dataBundle: string): Record<string, unknown> {
  if (!dataBundle) return {};
  try {
    const parsed = JSON.parse(dataBundle);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function verdictFor(
  capabilityId: string,
  status: CapabilityRunStatus,
  data: unknown
): ResearchVerdict {
  if (status !== 'success') return 'unavailable';

  switch (capabilityId) {
    case 'market.quote': {
      const change = field(data, 'change');
      if (change === null) return 'unavailable';
      return change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
    }
    case 'market.kline': {
      if (!Array.isArray(data) || data.length < 2) return 'unavailable';
      const first = field(data[0], 'close');
      const last = field(data[data.length - 1], 'close');
      if (first === null || last === null) return 'unavailable';
      return last > first ? 'positive' : last < first ? 'negative' : 'neutral';
    }
    case 'company.valuation': {
      const pe = field(data, 'pe');
      if (pe === null) return 'unavailable';
      if (pe < 18) return 'positive';
      if (pe > 40) return 'negative';
      return 'neutral';
    }
    default:
      // Data is present but there is no honest, deterministic directional
      // signal to extract for this dimension.
      return 'neutral';
  }
}

function majorityStance(verdicts: ResearchVerdict[]): ResearchStance {
  let positive = 0;
  let negative = 0;
  for (const verdict of verdicts) {
    if (verdict === 'positive') positive += 1;
    else if (verdict === 'negative') negative += 1;
  }
  if (positive > negative) return 'bullish';
  if (negative > positive) return 'bearish';
  return 'neutral';
}

function sectionSummary(
  capabilityId: string,
  verdict: ResearchVerdict,
  run?: { error?: string }
): string {
  const title = SECTION_TITLES[capabilityId] ?? capabilityId;
  switch (verdict) {
    case 'unavailable':
      return run?.error ? `${title} unavailable: ${run.error}` : `${title} data unavailable.`;
    case 'positive':
      return `${title} reads positive.`;
    case 'negative':
      return `${title} reads negative.`;
    default:
      return `${title} reads neutral.`;
  }
}

function casePoints(
  planned: string[],
  verdicts: ResearchVerdict[]
): { bull: string[]; bear: string[] } {
  const bull: string[] = [];
  const bear: string[] = [];
  planned.forEach((capabilityId, index) => {
    const title = SECTION_TITLES[capabilityId] ?? capabilityId;
    if (verdicts[index] === 'positive') bull.push(`${title} is favorable.`);
    else if (verdicts[index] === 'negative') bear.push(`${title} is unfavorable.`);
  });
  return { bull, bear };
}

function summaryText(symbol: string, verdicts: ResearchVerdict[]): string {
  const positive = verdicts.filter((v) => v === 'positive').length;
  const negative = verdicts.filter((v) => v === 'negative').length;
  const unavailable = verdicts.filter((v) => v === 'unavailable').length;
  return `${symbol}: ${positive} positive, ${negative} negative, ${unavailable} unavailable signals.`;
}

function field(data: unknown, key: string): number | null {
  if (data && typeof data === 'object') {
    const value = (data as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return null;
}

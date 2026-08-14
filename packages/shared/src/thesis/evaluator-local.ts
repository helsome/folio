import type {
  InvestmentThesis,
  ThesisImpactEvaluator,
  ThesisImpactInput,
  ThesisImpactKind,
} from '@finagent/core';
import { isRecord, toFiniteNumber } from '../guards.ts';

/**
 * Deterministic ThesisImpactEvaluator used by tests and the LocalRuntime.
 *
 * Honest heuristics over the fresh `dataBundle` (never fabricates prose):
 *   1. hard negative event keyword in fresh news  → 'invalidated'
 *   2. quote move > 5% against the stance,
 *      or analyst consensus against the stance     → 'weakened'
 *   3. quote move > 5% with the stance,
 *      or analyst consensus with the stance        → 'strengthened'
 *   4. otherwise (including missing data)          → 'unchanged'
 *
 * Precedence: negative facts trump positive; missing data is never treated as a
 * signal. A neutral thesis is neither for nor against a price move.
 */

const HARD_NEGATIVE_KEYWORDS = [
  'bankruptcy',
  'chapter 11',
  'layoffs',
  'laying off',
  'delisting',
  'delist',
  'liquidation',
];

const RATING_BY_LABEL: Record<string, 'buy' | 'neutral' | 'sell'> = {
  buy: 'buy',
  strong_buy: 'buy',
  overweight: 'buy',
  outperform: 'buy',
  sell: 'sell',
  strong_sell: 'sell',
  underweight: 'sell',
  underperform: 'sell',
  hold: 'neutral',
  neutral: 'neutral',
  equal_weight: 'neutral',
};

export function createLocalThesisEvaluator(now: () => number = Date.now): ThesisImpactEvaluator {
  return {
    async evaluate(input) {
      return evaluateLocal(input, now);
    },
  };
}

interface ImpactVerdict {
  kind: ThesisImpactKind;
  summary: string;
  updatedThesis: InvestmentThesis;
}

function evaluateLocal(input: ThesisImpactInput, now: () => number): ImpactVerdict {
  const { thesis } = input;
  const bundle = parseBundle(input.dataBundle);

  if (Object.keys(bundle).length === 0) {
    return verdict('unchanged', 'No fresh capability data was available; the thesis is unchanged.', thesis, now());
  }

  // 1. Hard negative news → invalidated (highest priority).
  const newsText = extractNewsText(bundle['research.news']);
  const keyword = HARD_NEGATIVE_KEYWORDS.find((k) => newsText.includes(k));
  if (keyword) {
    return verdict(
      'invalidated',
      `Hard negative news for ${thesis.symbol} mentions "${keyword}"; the thesis is invalidated.`,
      thesis,
      now()
    );
  }

  // 2. Quote move > 5% against/with the stance.
  const changePercent = toFiniteNumber(isRecord(bundle['market.quote']) ? bundle['market.quote'].changePercent : undefined);
  const quoteSignal = quoteMoveSignal(changePercent, thesis.stance);

  // 3. Analyst consensus against/with the stance.
  const ratingSignal = ratingSignalFor(extractRating(bundle['company.ratings']), thesis.stance);

  if (quoteSignal === 'against' || ratingSignal === 'against') {
    const reasons = againstReasons(quoteSignal, changePercent, ratingSignal);
    return verdict('weakened', `The thesis is weakened: ${reasons.join('; ')}.`, thesis, now());
  }

  if (quoteSignal === 'with' || ratingSignal === 'with') {
    const reasons = withReasons(quoteSignal, changePercent, ratingSignal);
    return verdict('strengthened', `The thesis is strengthened: ${reasons.join('; ')}.`, thesis, now());
  }

  return verdict('unchanged', 'No material change detected; the thesis stands unchanged.', thesis, now());
}

function verdict(
  kind: ThesisImpactKind,
  summary: string,
  thesis: InvestmentThesis,
  timestamp: number
): ImpactVerdict {
  return {
    kind,
    summary,
    updatedThesis: { ...thesis, updatedAt: timestamp, lastReviewedAt: timestamp },
  };
}

function parseBundle(dataBundle: string): Record<string, unknown> {
  if (!dataBundle) return {};
  try {
    const parsed = JSON.parse(dataBundle);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractNewsText(data: unknown): string {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (!isRecord(item)) return '';
        return `${item.title ?? ''} ${item.summary ?? ''}`;
      })
      .join(' ')
      .toLowerCase();
  }
  return '';
}

function quoteMoveSignal(changePercent: number | undefined, stance: InvestmentThesis['stance']): 'with' | 'against' | 'none' {
  if (changePercent === undefined || Math.abs(changePercent) <= 5 || stance === 'neutral') return 'none';
  return changePercent >= 0 === (stance === 'bullish') ? 'with' : 'against';
}

function extractRating(data: unknown): 'buy' | 'neutral' | 'sell' | undefined {
  if (Array.isArray(data)) {
    const counts = { buy: 0, neutral: 0, sell: 0 };
    for (const item of data) {
      if (!isRecord(item)) continue;
      const label = RATING_BY_LABEL[String(item.rating ?? item.recommend ?? '').toLowerCase()];
      if (label) counts[label] += 1;
    }
    const total = counts.buy + counts.neutral + counts.sell;
    if (total === 0) return undefined;
    if (counts.buy > counts.sell && counts.buy >= counts.neutral) return 'buy';
    if (counts.sell > counts.buy && counts.sell >= counts.neutral) return 'sell';
    return 'neutral';
  }
  if (isRecord(data)) {
    return RATING_BY_LABEL[String(data.consensus ?? data.recommend ?? data.rating ?? '').toLowerCase()];
  }
  return undefined;
}

function ratingSignalFor(rating: 'buy' | 'neutral' | 'sell' | undefined, stance: InvestmentThesis['stance']): 'with' | 'against' | 'none' {
  if (!rating || stance === 'neutral' || rating === 'neutral') return 'none';
  return rating === 'buy' === (stance === 'bullish') ? 'with' : 'against';
}

function againstReasons(
  quoteSignal: 'with' | 'against' | 'none',
  changePercent: number | undefined,
  ratingSignal: 'with' | 'against' | 'none'
): string[] {
  const reasons: string[] = [];
  if (quoteSignal === 'against' && changePercent !== undefined) {
    reasons.push(`price moved ${changePercent.toFixed(1)}% against the stance`);
  }
  if (ratingSignal === 'against') reasons.push('analyst consensus now runs against the stance');
  return reasons;
}

function withReasons(
  quoteSignal: 'with' | 'against' | 'none',
  changePercent: number | undefined,
  ratingSignal: 'with' | 'against' | 'none'
): string[] {
  const reasons: string[] = [];
  if (quoteSignal === 'with' && changePercent !== undefined) {
    reasons.push(`price moved ${changePercent.toFixed(1)}% with the stance`);
  }
  if (ratingSignal === 'with') reasons.push('analyst consensus supports the stance');
  return reasons;
}

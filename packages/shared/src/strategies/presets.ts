import type { ResearchStrategy, StrategyId } from '@finagent/core';

/**
 * V5 research strategy presets (spec §12).
 *
 * A strategy is a product-facing orchestration layer: it activates existing
 * skills (the agent knowledge layer) and selects the capabilities the research
 * plan fetches (the data layer). The planner consumes these presets; the
 * research service runs them. Presets never duplicate skill prompts — they
 * reuse the real skill ids from the skill hub's `skillCapabilityMap`.
 *
 * Capability ids are drawn from `TARGET_CAPABILITY_IDS` only, in the canonical
 * comprehensive order (market → company → research), so every preset's
 * capability list is a subsequence of `COMPREHENSIVE_CAPABILITY_IDS`.
 *
 * Naming reality check (skill ids below are the real keys of
 * `skillCapabilityMap` in @finagent/skill-hub):
 *   - `longbridge-value-investing`  — Graham/Buffett value scores
 *   - `longbridge-fundamentals`     — financials/valuation/dividends/profile
 *   - `longbridge-earnings`         — EPS consensus, financials, ratings, news
 *   - `longbridge-technical`        — indicator frameworks on OHLCV + quote
 *   - `longbridge-content`          — news + filings + community topics
 *   - `longbridge-research`         — ratings/consensus/calendar (institutional)
 *   - `longbridge-quant`            — indicator scripts / factor models
 *   - `longbridge-market-data`      — the real-time market data surfaces
 *   - plus `longbridge`, `longbridge-portfolio`, `longbridge-derivatives`,
 *     `longbridge-intel`, `longbridge-watchlist` (full-spectrum coverage).
 */

/** Every market + company + research capability, in canonical plan order. */
export const COMPREHENSIVE_CAPABILITY_IDS = [
  'market.quote',
  'market.kline',
  'market.intraday',
  'market.depth',
  'market.trades',
  'market.capitalFlow',
  'market.sentiment',
  'market.status',
  'company.profile',
  'company.valuation',
  'company.financials',
  'company.dividends',
  'company.earnings',
  'company.ratings',
  'research.news',
  'research.events',
] as const;

export const RESEARCH_STRATEGIES: Record<StrategyId, ResearchStrategy> = {
  comprehensive: {
    id: 'comprehensive',
    name: 'Comprehensive',
    description: 'Full-spectrum deep dive across market, company and research data.',
    focus: ['full plan', 'market', 'company', 'research'],
    skillIds: [
      'longbridge',
      'longbridge-market-data',
      'longbridge-technical',
      'longbridge-fundamentals',
      'longbridge-quant',
      'longbridge-research',
      'longbridge-derivatives',
      'longbridge-earnings',
      'longbridge-intel',
      'longbridge-content',
      'longbridge-portfolio',
      'longbridge-value-investing',
      'longbridge-watchlist',
    ],
    capabilityIds: [...COMPREHENSIVE_CAPABILITY_IDS],
  },

  value: {
    id: 'value',
    name: 'Value',
    description: 'Fundamental value analysis — valuation multiples, financials and dividend history.',
    focus: ['valuation', 'financials', 'dividends', 'profile'],
    skillIds: ['longbridge-fundamentals', 'longbridge-value-investing'],
    capabilityIds: [
      'company.profile',
      'company.valuation',
      'company.financials',
      'company.dividends',
    ],
  },

  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Growth focus — revenue/EPS trajectory, consensus estimates and valuation.',
    focus: ['earnings growth', 'consensus', 'valuation'],
    skillIds: ['longbridge-earnings', 'longbridge-fundamentals'],
    capabilityIds: ['company.valuation', 'company.financials', 'company.earnings'],
  },

  technical: {
    id: 'technical',
    name: 'Technical',
    description: 'Technical analysis — price trend, intraday action, order flow and market temperature.',
    focus: ['price action', 'trend', 'depth', 'trades'],
    skillIds: ['longbridge-technical'],
    capabilityIds: [
      'market.kline',
      'market.intraday',
      'market.depth',
      'market.trades',
      'market.sentiment',
    ],
  },

  earnings: {
    id: 'earnings',
    name: 'Earnings',
    description: 'Earnings intelligence — EPS forecasts, calendar catalysts and news.',
    focus: ['EPS forecasts', 'calendar', 'news'],
    skillIds: ['longbridge-earnings'],
    capabilityIds: ['company.earnings', 'research.news', 'research.events'],
  },

  'event-driven': {
    id: 'event-driven',
    name: 'Event-Driven',
    description: 'Event-driven scan — news, calendar, ratings changes and dividend actions.',
    focus: ['news', 'catalysts', 'ratings', 'dividends'],
    skillIds: ['longbridge-content', 'longbridge-research'],
    capabilityIds: [
      'company.dividends',
      'company.ratings',
      'research.news',
      'research.events',
    ],
  },

  'risk-review': {
    id: 'risk-review',
    name: 'Risk Review',
    description: 'Risk review — financial red flags, news, ratings and trend health.',
    focus: ['financials', 'news', 'ratings', 'trend'],
    skillIds: ['longbridge-research', 'longbridge-fundamentals'],
    capabilityIds: [
      'market.kline',
      'company.financials',
      'company.ratings',
      'research.news',
    ],
  },

  income: {
    id: 'income',
    name: 'Income',
    description: 'Income focus — dividend history, payout capacity and financial stability.',
    focus: ['dividends', 'yield', 'payout', 'profile'],
    skillIds: ['longbridge-fundamentals'],
    capabilityIds: [
      'company.profile',
      'company.financials',
      'company.dividends',
      'company.earnings',
    ],
  },
};

/** True when `value` names a real preset — guards IPC/service input. */
export function isStrategyId(value: string): value is StrategyId {
  return Object.hasOwn(RESEARCH_STRATEGIES, value);
}

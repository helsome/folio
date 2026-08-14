import type { SkillCapabilityRequirements } from '@finagent/core';

/**
 * Per-skill capability requirements.
 *
 * Each vendored skill is mapped to the capabilities its CLI workflow depends
 * on. `required` holds the capabilities the skill's core methodology cannot
 * run without; `optional` holds nice-to-have capabilities. Capabilities that
 * are not yet implemented (options, intel scanning, filings/topics, watchlist
 * management, etc.) are declared under their own ids so they surface as
 * `missing` in readiness — never faked as covered.
 *
 * Command → capability id mapping (from the architecture contract §5), plus
 * the extra ids introduced for unimplemented commands:
 *
 *   quote            → market.quote        financial-report → company.financials
 *   kline            → market.kline        financial-statement → company.financials
 *   intraday         → market.intraday     institution-rating → company.ratings
 *   depth / brokers  → market.depth        forecast-eps / consensus / analyst-estimates
 *   trades           → market.trades                                     → company.earnings
 *   capital          → market.capitalFlow  dividend          → company.dividends
 *   market-temp      → market.sentiment    static            → company.profile
 *   trading / market-status → market.status calc-index / valuation / valuation-rank
 *   news             → research.news                                     → company.valuation
 *   finance-calendar → research.events     portfolio         → portfolio.summary
 *   positions        → portfolio.positions  assets            → portfolio.assets
 *   cash-flow        → portfolio.cashFlow
 *
 *   Unimplemented (extra ids, never faked as covered):
 *   option/warrant   → options.chain / options.greeks / options.warrants
 *   screener/rank/top-movers/anomaly/constituent
 *                    → intel.screener / intel.rankings / intel.anomalies / intel.constituents
 *   filing / topic   → content.filings / content.topics
 *   watchlist/alert/sharelist → watchlist.manage / watchlist.alerts / watchlist.sharelist
 *   shareholder/fund-holder/insider-trades/investors/short-positions/industry-*
 *                    → research.shareholders / research.insiderTrades /
 *                      research.investors / research.shortPositions / research.industry
 *   business-segments/executive → company.segments / company.executives
 *   security-list/participants/subscriptions/ah-premium/trade-stats/exchange-rate/ipo
 *                    → market.securityList / market.participants / market.subscriptions /
 *                      market.ahPremium / market.tradeStats / market.exchangeRate / market.ipo
 *   order/margin-ratio/statement/dca/profit-analysis
 *                    → portfolio.orders / portfolio.margin / portfolio.statement /
 *                      portfolio.dca / portfolio.profitAnalysis
 */
export const skillCapabilityMap: Record<string, SkillCapabilityRequirements> = {
  // Broad base skill — preferred for any stock/market question. Depends on the
  // core market-data, fundamental, news and portfolio read surfaces.
  longbridge: {
    required: [
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.sentiment',
      'company.profile',
      'company.financials',
      'company.valuation',
      'company.earnings',
      'research.news',
      'portfolio.summary',
      'portfolio.positions',
      'portfolio.assets',
    ],
    optional: [
      'market.depth',
      'market.trades',
      'market.capitalFlow',
      'market.status',
      'company.ratings',
      'company.dividends',
      'research.events',
      'portfolio.cashFlow',
      'content.filings',
      'content.topics',
      'research.investors',
      'research.insiderTrades',
      'market.ipo',
    ],
  },

  // Real-time/historical market data. Core is quote + OHLCV + order book +
  // ticks + capital flow + sentiment + session status; the rest are niche
  // sub-topics (security lists, A/H premium, IPO, exchange rates, ...).
  'longbridge-market-data': {
    required: [
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.depth',
      'market.trades',
      'market.capitalFlow',
      'market.sentiment',
      'market.status',
    ],
    optional: [
      'company.profile',
      'company.valuation',
      'market.securityList',
      'market.participants',
      'market.subscriptions',
      'market.ahPremium',
      'market.tradeStats',
      'market.exchangeRate',
      'market.ipo',
    ],
  },

  // Technical analysis — every framework runs on OHLCV (kline) plus the
  // current quote for entry/exit context.
  'longbridge-technical': {
    required: ['market.kline', 'market.quote'],
    optional: [],
  },

  // Financial statements, valuation, dividends, company info.
  'longbridge-fundamentals': {
    required: ['company.financials', 'company.valuation', 'company.dividends', 'company.profile'],
    optional: ['company.segments', 'company.executives', 'research.events'],
  },

  // Quantitative strategies — indicator scripts run against kline data; factor
  // models/screeners additionally lean on valuation and financials.
  'longbridge-quant': {
    required: ['market.kline'],
    optional: ['market.quote', 'company.valuation', 'company.financials', 'company.dividends'],
  },

  // Institutional research — ratings/consensus/calendar plus shareholder/flow
  // data that is not yet implemented (surfaces as missing).
  'longbridge-research': {
    required: [
      'company.ratings',
      'company.earnings',
      'research.events',
      'research.shareholders',
      'research.insiderTrades',
      'research.investors',
      'research.shortPositions',
    ],
    optional: ['research.industry'],
  },

  // Options & warrants — entirely driven by options/warrant data (unimplemented).
  'longbridge-derivatives': {
    required: ['options.chain', 'options.greeks', 'options.warrants'],
    optional: ['market.quote'],
  },

  // Earnings — collect.py pulls financials, consensus/estimates, ratings,
  // valuation, quote, kline and news; business segments feed the revenue table.
  'longbridge-earnings': {
    required: [
      'company.financials',
      'company.earnings',
      'company.ratings',
      'company.valuation',
      'market.quote',
      'market.kline',
      'research.news',
    ],
    optional: ['company.segments'],
  },

  // Market intelligence — screening/ranking/anomalies/constituents are all
  // unimplemented (surfaces as missing).
  'longbridge-intel': {
    required: ['intel.screener', 'intel.rankings', 'intel.anomalies', 'intel.constituents'],
    optional: ['research.news', 'research.events', 'market.quote', 'market.capitalFlow'],
  },

  // News + filings + community topics.
  'longbridge-content': {
    required: ['research.news', 'content.filings', 'content.topics'],
    optional: [],
  },

  // Account & orders — read surfaces are implemented; order/statement/DCA and
  // margin tooling are not yet (surfaces as missing).
  'longbridge-portfolio': {
    required: ['portfolio.summary', 'portfolio.positions', 'portfolio.assets', 'portfolio.cashFlow'],
    optional: [
      'portfolio.orders',
      'portfolio.margin',
      'portfolio.statement',
      'portfolio.dca',
      'portfolio.profitAnalysis',
    ],
  },

  // Graham/Buffett value investing — balance sheet, valuation multiples,
  // dividends and current price drive every score.
  'longbridge-value-investing': {
    required: ['company.financials', 'company.valuation', 'company.dividends', 'market.quote'],
    optional: ['company.profile', 'market.kline'],
  },

  // Watchlist / price alerts / community sharelists — all unimplemented.
  'longbridge-watchlist': {
    required: ['watchlist.manage', 'watchlist.alerts', 'watchlist.sharelist'],
    optional: ['market.quote'],
  },
};

/** Capability ids a skill requires but that are not registered (never faked). */
export type { CapabilityId, SkillCapabilityRequirements } from '@finagent/core';

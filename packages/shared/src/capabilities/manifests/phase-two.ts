import { Type } from '@sinclair/typebox';
import type { FinanceCapability } from '@finagent/core';
import type {
  Assets,
  CalendarEvent,
  CapitalFlow,
  CashFlowRecord,
  Depth,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  InstitutionRating,
  MarketTemperature,
  Position,
  TradeTick,
} from '@finagent/longbridge-tools';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

// ── market.depth ────────────────────────────────────────────────────────────

export function createMarketDepthCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, Depth> {
  return defineCapability<{ symbol: string }, Depth>({
    id: 'market.depth',
    name: 'Order Book Depth',
    toolName: 'get_market_depth',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get Level 2 order book depth for a symbol: up to 10 bid and ask price levels with price, volume, and order counts. Use this to gauge near-term support/resistance and order-flow imbalance.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const depth = await fetchers.getDepth(symbol);
      return {
        data: depth,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `Depth for ${depth.symbol}: ${depth.bids.length} bid levels, ${depth.asks.length} ask levels.`,
      };
    },
  });
}

// ── market.trades ───────────────────────────────────────────────────────────

export function createMarketTradesCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string; count?: number }, TradeTick[]> {
  return defineCapability<{ symbol: string; count?: number }, TradeTick[]>({
    id: 'market.trades',
    name: 'Recent Trades',
    toolName: 'get_trades',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get recent tick-by-tick trades for a symbol with price, volume, direction, and time. Use this to inspect short-term trading activity and order flow.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
      count: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 1000 })),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const trades = await fetchers.getTrades(symbol, input.count ?? 20);
      const latest = trades[0];
      return {
        data: trades,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: latest?.timestamp,
          stale: false,
        },
        summary: `${trades.length} recent trades for ${symbol}${latest ? `, latest @ $${latest.price.toFixed(2)}` : ''}.`,
      };
    },
  });
}

// ── market.capitalFlow ──────────────────────────────────────────────────────

export function createMarketCapitalFlowCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, CapitalFlow> {
  return defineCapability<{ symbol: string }, CapitalFlow>({
    id: 'market.capitalFlow',
    name: 'Capital Flow',
    toolName: 'get_capital_flow',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get the intraday capital-flow distribution for a symbol: large/medium/small order inflow and outflow. Use this to judge whether money is flowing into or out of a stock.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const flow = await fetchers.getCapitalFlow(symbol);
      const netLarge = flow.capitalIn.large - flow.capitalOut.large;
      return {
        data: flow,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: flow.timestamp,
          stale: false,
        },
        summary: `Capital flow for ${flow.symbol}: inflow L${fmt(flow.capitalIn.large)} M${fmt(flow.capitalIn.medium)} S${fmt(flow.capitalIn.small)}; outflow L${fmt(flow.capitalOut.large)} M${fmt(flow.capitalOut.medium)} S${fmt(flow.capitalOut.small)}.`,
      };
    },
  });
}

// ── market.sentiment ────────────────────────────────────────────────────────

export function createMarketSentimentCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ market?: string }, MarketTemperature> {
  return defineCapability<{ market?: string }, MarketTemperature>({
    id: 'market.sentiment',
    name: 'Market Sentiment',
    toolName: 'get_market_sentiment',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get the market sentiment temperature index (0–100) for a market (US/HK/CN/SG), plus valuation and sentiment sub-scores. Use this to gauge overall market risk appetite.',
    inputSchema: Type.Object({
      market: Type.Optional(
        Type.String({
          description: 'Market code: US, HK, CN (SH/SZ), or SG. Defaults to US.',
          examples: ['US', 'HK'],
        })
      ),
    }),
    async execute(input, ctx) {
      const temperature = await fetchers.getMarketTemperature(input.market ?? 'US');
      return {
        data: temperature,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${temperature.market} market temperature: ${temperature.temperature}/100 (${temperature.description}).`,
      };
    },
  });
}

// ── company.financials ──────────────────────────────────────────────────────

export function createCompanyFinancialsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string; kind?: 'IS' | 'BS' | 'CF' | 'ALL'; report?: string }, FinancialReport> {
  return defineCapability<{ symbol: string; kind?: 'IS' | 'BS' | 'CF' | 'ALL'; report?: string }, FinancialReport>({
    id: 'company.financials',
    name: 'Financial Statements',
    toolName: 'get_financials',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get financial statements (income statement, balance sheet, cash flow) for a symbol. Use this to analyze revenue, earnings, assets, liabilities, and cash generation over time.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
      kind: Type.Optional(
        Type.Union([
          Type.Literal('IS'),
          Type.Literal('BS'),
          Type.Literal('CF'),
          Type.Literal('ALL'),
        ])
      ),
      report: Type.Optional(
        Type.String({
          description: 'Report period: af (annual), saf (semi-annual), q1, 3q, qf (quarterly).',
        })
      ),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const report = await fetchers.getFinancialReport(
        symbol,
        input.kind ?? 'ALL',
        input.report
      );
      return {
        data: report,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `Financial statements for ${symbol}: ${formatStatementNames(report.statements)}.`,
      };
    },
  });
}

// ── company.ratings ─────────────────────────────────────────────────────────

export function createCompanyRatingsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, InstitutionRating> {
  return defineCapability<{ symbol: string }, InstitutionRating>({
    id: 'company.ratings',
    name: 'Institution Ratings',
    toolName: 'get_ratings',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get institution analyst ratings and target-price consensus for a symbol: recommendation (buy/hold/sell), average target price, and analyst distribution. Use this to gauge institutional sentiment.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const rating = await fetchers.getInstitutionRating(symbol);
      const target = rating.target !== undefined ? ` target $${rating.target.toFixed(2)}` : '';
      return {
        data: rating,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `Ratings for ${symbol}: consensus ${rating.recommend || 'n/a'}${target}.`,
      };
    },
  });
}

// ── company.dividends ───────────────────────────────────────────────────────

export function createCompanyDividendsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, DividendRecord[]> {
  return defineCapability<{ symbol: string }, DividendRecord[]>({
    id: 'company.dividends',
    name: 'Dividend History',
    toolName: 'get_dividends',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get the dividend history for a symbol (ex-dividend, record, and payment dates with descriptions). Use this to assess income yield and dividend consistency.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const dividends = await fetchers.getDividends(symbol);
      return {
        data: dividends,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${dividends.length} dividend records for ${symbol}.`,
      };
    },
  });
}

// ── company.earnings ────────────────────────────────────────────────────────

export function createCompanyEarningsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, EpsForecast[]> {
  return defineCapability<{ symbol: string }, EpsForecast[]>({
    id: 'company.earnings',
    name: 'EPS Forecasts',
    toolName: 'get_earnings',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get EPS forecasts and analyst consensus estimates for a symbol across upcoming periods. Use this to judge expected earnings growth and revisions.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. NVDA.US', examples: ['NVDA.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const forecasts = await fetchers.getEpsForecasts(symbol);
      const latest = forecasts[0];
      return {
        data: forecasts,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${forecasts.length} EPS forecasts for ${symbol}${latest ? `, next mean EPS ${latest.epsMean.toFixed(2)}` : ''}.`,
      };
    },
  });
}

// ── research.events ─────────────────────────────────────────────────────────

const CalendarEventType = Type.Union([
  Type.Literal('financial'),
  Type.Literal('report'),
  Type.Literal('dividend'),
  Type.Literal('ipo'),
  Type.Literal('macrodata'),
  Type.Literal('closed'),
]);

export type CalendarEventsInput = {
  eventType: 'financial' | 'report' | 'dividend' | 'ipo' | 'macrodata' | 'closed';
  symbols?: string[];
  start?: string;
  end?: string;
  count?: number;
};

export function createResearchEventsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<CalendarEventsInput, CalendarEvent[]> {
  return defineCapability<CalendarEventsInput, CalendarEvent[]>({
    id: 'research.events',
    name: 'Finance Calendar',
    toolName: 'get_calendar_events',
    category: 'research',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get upcoming finance-calendar events (financial reports/earnings, dividends, IPOs, macro data, market closures). Use this to find catalysts and scheduled corporate actions.',
    inputSchema: Type.Object({
      eventType: CalendarEventType,
      symbols: Type.Optional(Type.Array(Type.String({ description: 'Symbol filter' }))),
      start: Type.Optional(Type.String({ description: 'Start date (YYYY-MM-DD)' })),
      end: Type.Optional(Type.String({ description: 'End date (YYYY-MM-DD)' })),
      count: Type.Optional(Type.Number({ default: 100, minimum: 1, maximum: 1000 })),
    }),
    async execute(input, ctx) {
      const events = await fetchers.getCalendarEvents({
        eventType: input.eventType,
        symbols: input.symbols,
        start: input.start,
        end: input.end,
        count: input.count,
      });
      return {
        data: events,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${events.length} ${input.eventType} calendar events.`,
      };
    },
  });
}

// ── portfolio.positions ─────────────────────────────────────────────────────

export function createPortfolioPositionsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<Record<string, never>, Position[]> {
  return defineCapability<Record<string, never>, Position[]>({
    id: 'portfolio.positions',
    name: 'Positions',
    toolName: 'get_positions',
    category: 'portfolio',
    riskLevel: 'read',
    auth: 'account',
    description:
      'Get the current stock positions across all sub-accounts: symbol, name, quantity, available quantity, cost price, currency, and market. Use this when the user asks about their holdings.',
    inputSchema: Type.Object({}),
    async execute(_input, ctx) {
      const positions = await fetchers.getAccountPositions();
      return {
        data: positions,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${positions.length} positions held.`,
      };
    },
  });
}

// ── portfolio.assets ────────────────────────────────────────────────────────

export function createPortfolioAssetsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ currency?: string }, Assets[]> {
  return defineCapability<{ currency?: string }, Assets[]>({
    id: 'portfolio.assets',
    name: 'Account Assets',
    toolName: 'get_assets',
    category: 'portfolio',
    riskLevel: 'read',
    auth: 'account',
    description:
      'Get account asset overview: net assets, total cash, buy power, margins, risk level, and per-currency cash breakdown. Use this when the user asks about their account balance or buying power.',
    inputSchema: Type.Object({
      currency: Type.Optional(Type.String({ description: 'Filter by currency, e.g. USD, HKD' })),
    }),
    async execute(input, ctx) {
      const assets = await fetchers.getAssets(input.currency);
      const primary = assets[0];
      return {
        data: assets,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: primary
          ? `Assets: net $${primary.netAssets.toFixed(2)}, cash $${primary.totalCash.toFixed(2)}, buy power $${primary.buyPower.toFixed(2)}.`
          : 'No asset records returned.',
      };
    },
  });
}

// ── portfolio.cashFlow ──────────────────────────────────────────────────────

export function createPortfolioCashFlowCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ start?: string; end?: string }, CashFlowRecord[]> {
  return defineCapability<{ start?: string; end?: string }, CashFlowRecord[]>({
    id: 'portfolio.cashFlow',
    name: 'Cash Flow',
    toolName: 'get_cash_flow',
    category: 'portfolio',
    riskLevel: 'read',
    auth: 'account',
    description:
      'Get cash-flow records (deposits, withdrawals, dividends, settlements) with balances. Use this to review recent account money movements.',
    inputSchema: Type.Object({
      start: Type.Optional(Type.String({ description: 'Start date (YYYY-MM-DD), default 30 days ago' })),
      end: Type.Optional(Type.String({ description: 'End date (YYYY-MM-DD), default today' })),
    }),
    async execute(input, ctx) {
      const records = await fetchers.getCashFlow({ start: input.start, end: input.end });
      return {
        data: records,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: `${records.length} cash-flow records.`,
      };
    },
  });
}

// ── aggregation ─────────────────────────────────────────────────────────────

/**
 * The twelve wave-2 capabilities. Each manifest is a factory so tests and the
 * local backend can inject stubbed/cached fetchers; production builds from the
 * default (real Longbridge) fetchers.
 */
export function createPhaseTwoCapabilities(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability[] {
  return [
    createMarketDepthCapability(fetchers),
    createMarketTradesCapability(fetchers),
    createMarketCapitalFlowCapability(fetchers),
    createMarketSentimentCapability(fetchers),
    createCompanyFinancialsCapability(fetchers),
    createCompanyRatingsCapability(fetchers),
    createCompanyDividendsCapability(fetchers),
    createCompanyEarningsCapability(fetchers),
    createResearchEventsCapability(fetchers),
    createPortfolioPositionsCapability(fetchers),
    createPortfolioAssetsCapability(fetchers),
    createPortfolioCashFlowCapability(fetchers),
  ];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatStatementNames(
  statements: FinancialReport['statements']
): string {
  const names = Object.keys(statements);
  return names.length > 0 ? names.join(', ') : 'none';
}

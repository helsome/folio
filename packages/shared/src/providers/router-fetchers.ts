import type {
  AccountAssets,
  CalendarEventsQueryOptions,
  CalcIndex,
  CashFlowQueryOptions,
  CashFlowRecord,
  FinancialProviderRouter,
  Holding,
  IntradayData,
  Kline,
  KlineQueryOptions,
  MarketStatus,
  NewsItem,
  PortfolioSnapshot,
  ProviderError,
  ProviderResult,
  Quote,
  StaticInfo,
} from '@finagent/core';
import type {
  CalendarEvent,
  CapitalFlow,
  Depth,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  InstitutionRating,
  MarketTemperature,
  TradeTick,
} from '@finagent/core/market-data';

/**
 * Normalized failure thrown by the router-backed fetchers. Carries the stable
 * `ProviderError.code` and user-safe `message` so callers can branch on the
 * machine code without importing vendor types.
 */
export class ProviderFetchError extends Error {
  readonly code: string;
  readonly retryable?: boolean;

  constructor(error: ProviderError) {
    super(error.message);
    this.name = 'ProviderFetchError';
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

/**
 * Fetcher surface produced by `createRouterFetchers`. Structurally the
 * post-migration `CapabilityFetchers` contract (portfolio methods carry the
 * neutral `@finagent/core` account shapes); the router erases routing from
 * every consumer.
 */
export interface RouterCapabilityFetchers {
  getQuote: (symbol: string) => Promise<Quote>;
  getKline: (options: KlineQueryOptions) => Promise<Kline[]>;
  getIntraday: (symbol: string) => Promise<IntradayData[]>;
  getMarketStatus: () => Promise<MarketStatus[]>;
  getStaticInfo: (symbol: string) => Promise<StaticInfo>;
  getCalcIndex: (symbol: string) => Promise<CalcIndex>;
  getNews: (symbol: string) => Promise<NewsItem[]>;
  getPortfolio: () => Promise<PortfolioSnapshot>;
  getDepth: (symbol: string) => Promise<Depth>;
  getTrades: (symbol: string, count?: number) => Promise<TradeTick[]>;
  getCapitalFlow: (symbol: string) => Promise<CapitalFlow>;
  getMarketTemperature: (market?: string) => Promise<MarketTemperature>;
  getFinancialReport: (
    symbol: string,
    kind?: 'IS' | 'BS' | 'CF' | 'ALL',
    report?: string
  ) => Promise<FinancialReport>;
  getInstitutionRating: (symbol: string) => Promise<InstitutionRating>;
  getDividends: (symbol: string) => Promise<DividendRecord[]>;
  getEpsForecasts: (symbol: string) => Promise<EpsForecast[]>;
  getCalendarEvents: (options: CalendarEventsQueryOptions) => Promise<CalendarEvent[]>;
  getAccountPositions: () => Promise<Holding[]>;
  getAssets: (currency?: string) => Promise<AccountAssets[]>;
  getCashFlow: (options?: CashFlowQueryOptions) => Promise<CashFlowRecord[]>;
  execute: <T>(capabilityId: string, input: unknown, signal?: AbortSignal) => Promise<ProviderResult<T>>;
}

async function fetch<T>(
  router: FinancialProviderRouter,
  capabilityId: string,
  input: unknown
): Promise<T> {
  const result: ProviderResult<T> = await router.execute<T>(capabilityId, input);
  if (result.ok) {
    return result.data;
  }
  throw new ProviderFetchError(result.error);
}

/**
 * Build the router-backed fetchers. Each fetcher delegates to
 * `router.execute` with its capability id and input, then maps the
 * `ProviderResult` back to a plain `Promise` (throwing a normalized
 * `ProviderFetchError` on failure). The router owns primary/fallback routing;
 * these methods stay oblivious to which provider answered.
 */
export function createRouterFetchers(router: FinancialProviderRouter): RouterCapabilityFetchers {
  return {
    execute: (capabilityId, input, signal) => router.execute(capabilityId, input, signal),
    getQuote: (symbol) => fetch(router, 'market.quote', { symbol }),
    getKline: (options) => fetch(router, 'market.kline', options),
    getIntraday: (symbol) => fetch(router, 'market.intraday', { symbol }),
    getMarketStatus: () => fetch(router, 'market.status', {}),
    getStaticInfo: (symbol) => fetch(router, 'company.profile', { symbol }),
    getCalcIndex: (symbol) => fetch(router, 'company.valuation', { symbol }),
    getNews: (symbol) => fetch(router, 'research.news', { symbol }),
    getPortfolio: () => fetch(router, 'portfolio.summary', {}),
    getDepth: (symbol) => fetch(router, 'market.depth', { symbol }),
    getTrades: (symbol, count) => fetch(router, 'market.trades', { symbol, count }),
    getCapitalFlow: (symbol) => fetch(router, 'market.capitalFlow', { symbol }),
    getMarketTemperature: (market) => fetch(router, 'market.sentiment', { market }),
    getFinancialReport: (symbol, kind, report) =>
      fetch(router, 'company.financials', { symbol, kind, report }),
    getInstitutionRating: (symbol) => fetch(router, 'company.ratings', { symbol }),
    getDividends: (symbol) => fetch(router, 'company.dividends', { symbol }),
    getEpsForecasts: (symbol) => fetch(router, 'company.earnings', { symbol }),
    getCalendarEvents: (options) => fetch(router, 'research.events', options),
    getAccountPositions: () => fetch(router, 'portfolio.positions', {}),
    getAssets: (currency) => fetch(router, 'portfolio.assets', { currency }),
    getCashFlow: (options) => fetch(router, 'portfolio.cashFlow', { options }),
  };
}

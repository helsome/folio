import {
  summarizeInstrument,
  type AccountAssets,
  type CalcIndex,
  type CashFlowRecord,
  type FinancialProviderRouter,
  type Holding,
  type IntradayData,
  type InstrumentCandidateSummary,
  type Kline,
  type MarketStatus,
  type NewsItem,
  type PortfolioSnapshot,
  type ProviderError,
  type ProviderResult,
  type Quote,
  type StaticInfo,
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
import type {
  GetCalendarEventsOptions,
  GetCashFlowOptions,
  GetKlineOptions,
} from '@finagent/longbridge-tools';
import { attachResolvedInstrument, type InstrumentQueryResolver } from './instrument.ts';

/**
 * Normalized failure thrown by the router-backed fetchers. Carries the stable
 * `ProviderError.code` and user-safe `message` so callers can branch on the
 * machine code without importing vendor types.
 */
export class ProviderFetchError extends Error {
  readonly code: string;
  readonly retryable?: boolean;
  /** Present when `code` is `AMBIGUOUS_INSTRUMENT`. */
  readonly candidates?: InstrumentCandidateSummary[];

  constructor(error: ProviderError) {
    super(error.message);
    this.name = 'ProviderFetchError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.candidates = error.candidates;
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
  getKline: (options: GetKlineOptions) => Promise<Kline[]>;
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
  getCalendarEvents: (options: GetCalendarEventsOptions) => Promise<CalendarEvent[]>;
  getAccountPositions: () => Promise<Holding[]>;
  getAssets: (currency?: string) => Promise<AccountAssets[]>;
  getCashFlow: (options?: GetCashFlowOptions) => Promise<CashFlowRecord[]>;
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

export interface RouterFetcherOptions {
  /** Resolve user/ticker input to a canonical instrument before adapters run. */
  resolve?: InstrumentQueryResolver;
}

function bindSymbolInput(
  symbol: string,
  extra: Record<string, unknown>,
  resolve?: InstrumentQueryResolver
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...extra, symbol };
  if (!resolve) return input;
  const resolution = resolve(symbol);
  if (resolution.status === 'ambiguous') {
    const candidates = resolution.candidates.map(summarizeInstrument);
    throw new ProviderFetchError({
      code: 'AMBIGUOUS_INSTRUMENT',
      message: `Multiple instruments match "${symbol}" (${candidates
        .map((candidate) => candidate.instrumentId)
        .join(', ')}). Choose a market or a canonical id.`,
      candidates,
    });
  }
  return attachResolvedInstrument(input, resolution);
}

/**
 * Build the router-backed fetchers. Each fetcher delegates to
 * `router.execute` with its capability id and input, then maps the
 * `ProviderResult` back to a plain `Promise` (throwing a normalized
 * `ProviderFetchError` on failure). The router owns primary/fallback routing;
 * these methods stay oblivious to which provider answered.
 */
export function createRouterFetchers(
  router: FinancialProviderRouter,
  options: RouterFetcherOptions = {}
): RouterCapabilityFetchers {
  const resolve = options.resolve;
  return {
    getQuote: (symbol) => fetch(router, 'market.quote', bindSymbolInput(symbol, {}, resolve)),
    getKline: (options) =>
      fetch(router, 'market.kline', bindSymbolInput(options.symbol, { ...options }, resolve)),
    getIntraday: (symbol) => fetch(router, 'market.intraday', bindSymbolInput(symbol, {}, resolve)),
    getMarketStatus: () => fetch(router, 'market.status', {}),
    getStaticInfo: (symbol) =>
      fetch(router, 'company.profile', bindSymbolInput(symbol, {}, resolve)),
    getCalcIndex: (symbol) =>
      fetch(router, 'company.valuation', bindSymbolInput(symbol, {}, resolve)),
    getNews: (symbol) => fetch(router, 'research.news', bindSymbolInput(symbol, {}, resolve)),
    getPortfolio: () => fetch(router, 'portfolio.summary', {}),
    getDepth: (symbol) => fetch(router, 'market.depth', bindSymbolInput(symbol, {}, resolve)),
    getTrades: (symbol, count) =>
      fetch(router, 'market.trades', bindSymbolInput(symbol, { count }, resolve)),
    getCapitalFlow: (symbol) =>
      fetch(router, 'market.capitalFlow', bindSymbolInput(symbol, {}, resolve)),
    getMarketTemperature: (market) => fetch(router, 'market.sentiment', { market }),
    getFinancialReport: (symbol, kind, report) =>
      fetch(router, 'company.financials', bindSymbolInput(symbol, { kind, report }, resolve)),
    getInstitutionRating: (symbol) =>
      fetch(router, 'company.ratings', bindSymbolInput(symbol, {}, resolve)),
    getDividends: (symbol) =>
      fetch(router, 'company.dividends', bindSymbolInput(symbol, {}, resolve)),
    getEpsForecasts: (symbol) =>
      fetch(router, 'company.earnings', bindSymbolInput(symbol, {}, resolve)),
    getCalendarEvents: (options) => fetch(router, 'research.events', options),
    getAccountPositions: () => fetch(router, 'portfolio.positions', {}),
    getAssets: (currency) => fetch(router, 'portfolio.assets', { currency }),
    getCashFlow: (options) => fetch(router, 'portfolio.cashFlow', { options }),
  };
}

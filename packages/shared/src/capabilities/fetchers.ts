import type {
  AccountAssets,
  CalendarEventsQueryOptions,
  CalcIndex,
  CashFlowQueryOptions,
  CalendarEvent,
  CapitalFlow,
  CashFlowRecord,
  Depth,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  Holding,
  InstitutionRating,
  IntradayData,
  Kline,
  KlineQueryOptions,
  MarketStatus,
  MarketTemperature,
  NewsItem,
  PortfolioSnapshot,
  Quote,
  StaticInfo,
  TradeTick,
} from '@finagent/core';
import {
  getAccountPositions,
  getAssets,
  getCalcIndex,
  getCalendarEvents,
  getCapitalFlow,
  getCashFlow,
  getDepth,
  getDividends,
  getEpsForecasts,
  getFinancialReport,
  getInstitutionRating,
  getIntraday,
  getKline,
  getMarketStatus,
  getMarketTemperature,
  getNews,
  getPortfolio,
  getQuote,
  getStaticInfo,
  getTrades,
} from '@finagent/longbridge-tools';
import type { CapabilityProvenance, ProviderResult } from '@finagent/core';

/**
 * Provider fetchers consumed by the capability manifests. Production uses the
 * raw Longbridge fetchers; tests and the local backend can substitute a
 * `MarketDataService` (which satisfies this shape structurally) to inject
 * cached or stubbed data.
 */
export interface CapabilityFetchers {
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
  /** Optional structured gateway entry point used to preserve provenance. */
  execute?: <T>(capabilityId: string, input: unknown, signal?: AbortSignal) => Promise<ProviderResult<T>>;
}

export interface ResolvedCapabilityFetch<T> {
  data: T;
  provenance: CapabilityProvenance;
}

/** Resolve through the provider gateway when configured, preserving its provenance. */
export async function resolveCapabilityFetch<T>(
  fetchers: CapabilityFetchers,
  capabilityId: string,
  input: unknown,
  fallback: () => Promise<T>,
  now: () => number,
  marketTime?: number,
  signal?: AbortSignal
): Promise<ResolvedCapabilityFetch<T>> {
  if (fetchers.execute) {
    const result = await fetchers.execute<T>(capabilityId, input, signal);
    if (!result.ok) {
      const error = Object.assign(new Error(result.error.message), {
        code: result.error.code,
        retryable: result.error.retryable,
      });
      throw error;
    }
    return {
      data: result.data,
      provenance: {
        provider: result.provenance.providerId,
        providerId: result.provenance.providerId,
        fetchedAt: result.provenance.fetchedAt,
        marketTime: result.provenance.marketTime ?? marketTime,
        delayed: result.provenance.delayed,
        stale: result.provenance.stale,
      },
    };
  }
  return {
    data: await fallback(),
    provenance: { provider: 'longbridge', fetchedAt: now(), marketTime, stale: false },
  };
}

export const defaultCapabilityFetchers: CapabilityFetchers = {
  getQuote,
  getKline,
  getIntraday,
  getMarketStatus,
  getStaticInfo,
  getCalcIndex,
  getNews,
  getPortfolio,
  getDepth,
  getTrades,
  getCapitalFlow,
  getMarketTemperature,
  getFinancialReport,
  getInstitutionRating,
  getDividends,
  getEpsForecasts,
  getCalendarEvents,
  getAccountPositions,
  getAssets,
  getCashFlow,
};

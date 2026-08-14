import type {
  CalcIndex,
  IntradayData,
  Kline,
  MarketStatus,
  NewsItem,
  Portfolio,
  Quote,
  StaticInfo,
} from '@finagent/core';
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
  type GetCalendarEventsOptions,
  type GetCashFlowOptions,
  type GetKlineOptions,
} from '@finagent/longbridge-tools';

/**
 * Provider fetchers consumed by the capability manifests. Production uses the
 * raw Longbridge fetchers; tests and the local backend can substitute a
 * `MarketDataService` (which satisfies this shape structurally) to inject
 * cached or stubbed data.
 */
export interface CapabilityFetchers {
  getQuote: (symbol: string) => Promise<Quote>;
  getKline: (options: GetKlineOptions) => Promise<Kline[]>;
  getIntraday: (symbol: string) => Promise<IntradayData[]>;
  getMarketStatus: () => Promise<MarketStatus[]>;
  getStaticInfo: (symbol: string) => Promise<StaticInfo>;
  getCalcIndex: (symbol: string) => Promise<CalcIndex>;
  getNews: (symbol: string) => Promise<NewsItem[]>;
  getPortfolio: () => Promise<Portfolio>;
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
  getAccountPositions: () => Promise<Position[]>;
  getAssets: (currency?: string) => Promise<Assets[]>;
  getCashFlow: (options?: GetCashFlowOptions) => Promise<CashFlowRecord[]>;
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

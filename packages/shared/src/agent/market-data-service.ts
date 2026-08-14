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
  getLongBridgeStatus,
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
  type LongBridgeStatus,
} from '@finagent/longbridge-tools';

export interface MarketDataServiceOptions {
  quoteTTL?: number;
  klineTTL?: number;
  portfolioTTL?: number;
  statusTTL?: number;
  referenceTTL?: number;
  fetchers?: Partial<MarketDataFetchers>;
  now?: () => number;
}

export interface MarketDataFetchers {
  getQuote: (symbol: string) => Promise<Quote>;
  getKline: (options: GetKlineOptions) => Promise<Kline[]>;
  getIntraday: (symbol: string) => Promise<IntradayData[]>;
  getPortfolio: () => Promise<Portfolio>;
  getLongBridgeStatus: () => Promise<LongBridgeStatus>;
  getStaticInfo: (symbol: string) => Promise<StaticInfo>;
  getCalcIndex: (symbol: string) => Promise<CalcIndex>;
  getMarketStatus: () => Promise<MarketStatus[]>;
  getNews: (symbol: string) => Promise<NewsItem[]>;
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

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const defaultFetchers: MarketDataFetchers = {
  getQuote,
  getKline,
  getIntraday,
  getPortfolio,
  getLongBridgeStatus,
  getStaticInfo,
  getCalcIndex,
  getMarketStatus,
  getNews,
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

export class MarketDataService {
  private readonly quoteTTL: number;
  private readonly klineTTL: number;
  private readonly portfolioTTL: number;
  private readonly statusTTL: number;
  private readonly referenceTTL: number;
  private readonly fetchers: MarketDataFetchers;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: MarketDataServiceOptions = {}) {
    this.quoteTTL = options.quoteTTL ?? 30_000;
    this.klineTTL = options.klineTTL ?? 300_000;
    this.portfolioTTL = options.portfolioTTL ?? 60_000;
    this.statusTTL = options.statusTTL ?? 15_000;
    this.referenceTTL = options.referenceTTL ?? 600_000;
    this.fetchers = { ...defaultFetchers, ...options.fetchers };
    this.now = options.now ?? Date.now;
  }

  getQuote(symbol: string) {
    return this.cached(`quote:${symbol}`, this.quoteTTL, () => this.fetchers.getQuote(symbol));
  }

  getKline(options: GetKlineOptions) {
    const key = `kline:${options.symbol}:${options.period ?? '1d'}:${options.limit ?? 100}`;
    return this.cached(key, this.klineTTL, () => this.fetchers.getKline(options));
  }

  getIntraday(symbol: string) {
    return this.cached(`intraday:${symbol}`, this.quoteTTL, () => this.fetchers.getIntraday(symbol));
  }

  getPortfolio() {
    return this.cached('portfolio', this.portfolioTTL, () => this.fetchers.getPortfolio());
  }

  getLongBridgeStatus() {
    return this.cached('longbridge-status', this.statusTTL, () => this.fetchers.getLongBridgeStatus());
  }

  getStaticInfo(symbol: string) {
    return this.cached(`static:${symbol}`, this.referenceTTL, () => this.fetchers.getStaticInfo(symbol));
  }

  getCalcIndex(symbol: string) {
    return this.cached(`calc-index:${symbol}`, this.referenceTTL, () => this.fetchers.getCalcIndex(symbol));
  }

  getMarketStatus() {
    return this.cached('market-status', this.statusTTL, () => this.fetchers.getMarketStatus());
  }

  getNews(symbol: string) {
    return this.cached(`news:${symbol}`, this.quoteTTL, () => this.fetchers.getNews(symbol));
  }

  getDepth(symbol: string) {
    return this.cached(`depth:${symbol}`, this.quoteTTL, () => this.fetchers.getDepth(symbol));
  }

  getTrades(symbol: string, count = 20) {
    return this.cached(`trades:${symbol}:${count}`, this.quoteTTL, () =>
      this.fetchers.getTrades(symbol, count)
    );
  }

  getCapitalFlow(symbol: string) {
    return this.cached(`capital-flow:${symbol}`, this.quoteTTL, () =>
      this.fetchers.getCapitalFlow(symbol)
    );
  }

  getMarketTemperature(market = 'US') {
    return this.cached(`market-temp:${market}`, this.statusTTL, () =>
      this.fetchers.getMarketTemperature(market)
    );
  }

  getFinancialReport(symbol: string, kind: 'IS' | 'BS' | 'CF' | 'ALL' = 'ALL', report?: string) {
    const key = `financial-report:${symbol}:${kind}:${report ?? ''}`;
    return this.cached(key, this.referenceTTL, () =>
      this.fetchers.getFinancialReport(symbol, kind, report)
    );
  }

  getInstitutionRating(symbol: string) {
    return this.cached(`institution-rating:${symbol}`, this.referenceTTL, () =>
      this.fetchers.getInstitutionRating(symbol)
    );
  }

  getDividends(symbol: string) {
    return this.cached(`dividend:${symbol}`, this.referenceTTL, () =>
      this.fetchers.getDividends(symbol)
    );
  }

  getEpsForecasts(symbol: string) {
    return this.cached(`forecast-eps:${symbol}`, this.referenceTTL, () =>
      this.fetchers.getEpsForecasts(symbol)
    );
  }

  getCalendarEvents(options: GetCalendarEventsOptions) {
    const key = `calendar:${options.eventType}:${(options.symbols ?? []).join(',')}:${options.start ?? ''}:${options.end ?? ''}:${options.count ?? 100}`;
    return this.cached(key, this.referenceTTL, () => this.fetchers.getCalendarEvents(options));
  }

  getAccountPositions() {
    return this.cached('positions', this.portfolioTTL, () => this.fetchers.getAccountPositions());
  }

  getAssets(currency?: string) {
    return this.cached(`assets:${currency ?? ''}`, this.portfolioTTL, () =>
      this.fetchers.getAssets(currency)
    );
  }

  getCashFlow(options: GetCashFlowOptions = {}) {
    const key = `cash-flow:${options.start ?? ''}:${options.end ?? ''}`;
    return this.cached(key, this.portfolioTTL, () => this.fetchers.getCashFlow(options));
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  private async cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > this.now()) {
      return entry.data;
    }

    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = fetcher()
      .then((data) => {
        this.cache.set(key, { data, expiresAt: this.now() + ttl });
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

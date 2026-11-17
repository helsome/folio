import type {
  AccountAssets,
  CalcIndex,
  CashFlowRecord,
  Holding,
  IntradayData,
  Kline,
  MarketStatus,
  NewsItem,
  PortfolioSnapshot,
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
import type { CapabilityFetchResult } from '../capabilities/fetchers.ts';

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
  getQuoteResult?: (symbol: string, signal?: AbortSignal) => Promise<CapabilityFetchResult<Quote>>;
  getKline: (options: GetKlineOptions) => Promise<Kline[]>;
  getIntraday: (symbol: string) => Promise<IntradayData[]>;
  getPortfolio: () => Promise<PortfolioSnapshot>;
  getLongBridgeStatus: () => Promise<LongBridgeStatus>;
  getStaticInfo: (symbol: string) => Promise<StaticInfo>;
  getStaticInfoResult?: (symbol: string, signal?: AbortSignal) => Promise<CapabilityFetchResult<StaticInfo>>;
  getCalcIndex: (symbol: string) => Promise<CalcIndex>;
  getMarketStatus: (signal?: AbortSignal) => Promise<MarketStatus[]>;
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
  getAccountPositions: () => Promise<Holding[]>;
  getAssets: (currency?: string) => Promise<AccountAssets[]>;
  getCashFlow: (options?: GetCashFlowOptions) => Promise<CashFlowRecord[]>;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface SharedRequest {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
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
  private readonly sharedRequests = new Map<string, SharedRequest>();

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
    return this.getQuoteResult(symbol).then((result) => result.data);
  }

  getQuoteResult(symbol: string, signal?: AbortSignal): Promise<CapabilityFetchResult<Quote>> {
    const fetcher = this.fetchers.getQuoteResult ?? (async (query: string) => {
      const data = await this.fetchers.getQuote(query);
      return {
        data,
        provenance: {
          providerId: 'unknown', providerName: 'Unknown', fetchedAt: this.now(),
          marketTime: data.timestamp * 1000, stale: true,
        },
      };
    });
    return this.shared(`quote-result:${symbol}`, this.quoteTTL, (abort) => fetcher(symbol, abort), signal);
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

  getStaticInfo(symbol: string, signal?: AbortSignal) {
    const fetcher = this.fetchers.getStaticInfoResult
      ? (abort: AbortSignal) => this.fetchers.getStaticInfoResult!(symbol, abort).then((result) => result.data)
      : () => this.fetchers.getStaticInfo(symbol);
    return this.shared(`static:${symbol}`, this.referenceTTL, fetcher, signal);
  }

  getCalcIndex(symbol: string) {
    return this.cached(`calc-index:${symbol}`, this.referenceTTL, () => this.fetchers.getCalcIndex(symbol));
  }

  getMarketStatus(signal?: AbortSignal) {
    return this.shared('market-status', this.statusTTL, (abort) => this.fetchers.getMarketStatus(abort), signal);
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

  /** Cancel the provider only after its last subscriber leaves. */
  private shared<T>(key: string, ttl: number, fetcher: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error('Request aborted'));
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.data);
    let request = this.sharedRequests.get(key);
    if (!request) {
      const controller = new AbortController();
      request = { controller, consumers: 0, promise: Promise.resolve() };
      const current = request;
      current.promise = Promise.resolve().then(() => fetcher(controller.signal)).then((data) => {
        if (!controller.signal.aborted) this.cache.set(key, { data, expiresAt: this.now() + ttl });
        return data;
      }).finally(() => {
        if (this.sharedRequests.get(key) === current) this.sharedRequests.delete(key);
      });
      this.sharedRequests.set(key, current);
    }
    const current = request;
    current.consumers += 1;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal?.removeEventListener('abort', abort);
        current.consumers -= 1;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        if (current.consumers === 0) {
          current.controller.abort();
          if (this.sharedRequests.get(key) === current) this.sharedRequests.delete(key);
        }
        reject(new Error('Request aborted'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      current.promise.then(
        (data) => { if (finish()) resolve(data as T); },
        (error) => { if (finish()) reject(error); },
      );
    });
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

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
import {
  getCalcIndex,
  getIntraday,
  getKline,
  getLongBridgeStatus,
  getMarketStatus,
  getNews,
  getPortfolio,
  getQuote,
  getStaticInfo,
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

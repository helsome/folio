import type { IntradayData, Kline, Portfolio, Quote } from '@finagent/core';
import {
  getIntraday,
  getKline,
  getLongBridgeStatus,
  getPortfolio,
  getQuote,
  type GetKlineOptions,
  type LongBridgeStatus,
} from '@finagent/longbridge-tools';

export interface MarketDataServiceOptions {
  quoteTTL?: number;
  klineTTL?: number;
  portfolioTTL?: number;
  statusTTL?: number;
  fetchers?: Partial<MarketDataFetchers>;
  now?: () => number;
}

export interface MarketDataFetchers {
  getQuote: (symbol: string) => Promise<Quote>;
  getKline: (options: GetKlineOptions) => Promise<Kline[]>;
  getIntraday: (symbol: string) => Promise<IntradayData[]>;
  getPortfolio: () => Promise<Portfolio>;
  getLongBridgeStatus: () => Promise<LongBridgeStatus>;
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
};

export class MarketDataService {
  private readonly quoteTTL: number;
  private readonly klineTTL: number;
  private readonly portfolioTTL: number;
  private readonly statusTTL: number;
  private readonly fetchers: MarketDataFetchers;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: MarketDataServiceOptions = {}) {
    this.quoteTTL = options.quoteTTL ?? 30_000;
    this.klineTTL = options.klineTTL ?? 300_000;
    this.portfolioTTL = options.portfolioTTL ?? 60_000;
    this.statusTTL = options.statusTTL ?? 15_000;
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

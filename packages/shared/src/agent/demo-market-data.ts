import type { Holding, Kline, PortfolioAccount, PortfolioSnapshot, Quote } from '@finagent/core';
import type { MarketDataFetchers } from './market-data-service.ts';

/**
 * Built-in sample data for the offline demo path (#31 E2E, README offline
 * promise). `FINAGENT_DEMO_DATA=1` makes provider-unavailable fetchers fall
 * back to these deterministic values so the Copilot can demonstrate typed
 * answer blocks without any vendor credential. Mirrors the renderer demo
 * specs (`packages/ui/src/demo/demoData.ts`); every surface built on it MUST
 * label the content as sample data (block `source: 'demo'` → DemoBadge).
 */

/** Static spec per demo symbol (same values as the renderer demo dataset). */
const DEMO_QUOTE_SPECS: Record<string, { lastPrice: number; changePercent: number; volume: number }> = {
  'AAPL.US': { lastPrice: 189.43, changePercent: 1.2, volume: 52_400_000 },
  'TSLA.US': { lastPrice: 175.22, changePercent: -2.1, volume: 98_100_000 },
  'NVDA.US': { lastPrice: 880.12, changePercent: 4.2, volume: 41_300_000 },
  'MSFT.US': { lastPrice: 412.6, changePercent: 1.8, volume: 22_700_000 },
  'AMZN.US': { lastPrice: 132.45, changePercent: 0.8, volume: 38_900_000 },
  'GOOGL.US': { lastPrice: 138.9, changePercent: -1.2, volume: 26_500_000 },
  'META.US': { lastPrice: 318.65, changePercent: -0.5, volume: 14_800_000 },
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stable pseudo-random in [0, 1) derived from a string seed. */
function seeded(seed: string, salt: number): number {
  let hash = salt;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return (hash % 1000) / 1000;
}

function demoQuoteFor(symbol: string): Quote {
  const spec = DEMO_QUOTE_SPECS[symbol.toUpperCase()];
  const lastPrice = spec?.lastPrice ?? round2(40 + seeded(symbol, 7) * 320);
  const changePercent = spec?.changePercent ?? round2((seeded(symbol, 13) - 0.45) * 6);
  const volume = spec?.volume ?? Math.round(1_000_000 + seeded(symbol, 29) * 80_000_000);
  const prevClose = round2(lastPrice / (1 + changePercent / 100));
  const change = round2(lastPrice - prevClose);
  const dayOpen = round2(prevClose * (1 + (seeded(symbol, 41) - 0.5) * 0.01));
  return {
    symbol: symbol.toUpperCase(),
    lastPrice,
    change,
    changePercent,
    volume,
    // Repo convention: Quote timestamps are epoch SECONDS.
    timestamp: Math.floor(Date.now() / 1000),
    high: round2(Math.max(lastPrice, dayOpen) * 1.004),
    low: round2(Math.min(lastPrice, dayOpen) * 0.996),
    open: dayOpen,
    prevClose,
  };
}

/** Deterministic daily close series ending at the demo quote's last price. */
function demoKlinesFor(symbol: string, limit?: number): Kline[] {
  const count = Math.max(2, Math.min(limit ?? 30, 400));
  const quote = demoQuoteFor(symbol);
  const klines: Kline[] = [];
  const daySeconds = 86_400;
  const todayUtc = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  for (let index = count - 1; index >= 0; index -= 1) {
    const step = count - 1 - index;
    const drift = (seeded(symbol, index + 3) - 0.5) * 0.02;
    const close = round2(quote.lastPrice / Math.pow(1 + drift, step));
    const open = round2(close * (1 + (seeded(symbol, index + 61) - 0.5) * 0.008));
    klines.push({
      symbol: quote.symbol,
      timestamp: todayUtc - index * daySeconds,
      open,
      high: round2(Math.max(open, close) * 1.006),
      low: round2(Math.min(open, close) * 0.994),
      close,
      volume: Math.round(10_000_000 + seeded(symbol, index + 97) * 60_000_000),
    });
  }
  return klines;
}

function demoPortfolioSnapshot(): PortfolioSnapshot {
  const symbols = ['AAPL.US', 'NVDA.US', 'MSFT.US', 'TSLA.US'];
  const quantities: Record<string, number> = { 'AAPL.US': 120, 'NVDA.US': 40, 'MSFT.US': 60, 'TSLA.US': 80 };
  const holdings: Holding[] = symbols.map((symbol, index) => {
    const quote = demoQuoteFor(symbol);
    const marketValue = round2(quote.lastPrice * (quantities[symbol] ?? 10));
    return {
      symbol,
      name: symbol,
      currency: 'USD',
      quantity: quantities[symbol] ?? 10,
      marketPrice: quote.lastPrice,
      marketValue,
      marketValueBase: marketValue,
      unrealizedPnLPercent: round2((seeded(symbol, index + 151) - 0.3) * 24),
      costPrice: round2(quote.lastPrice * 0.92),
    };
  });
  const cash = 12_500;
  const marketValue = round2(holdings.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0));
  const accounts: PortfolioAccount[] = [
    { id: 'demo', name: 'Demo Account', market: 'US', currency: 'USD', netAssets: round2(marketValue + cash), cash },
  ];
  return {
    baseCurrency: 'USD',
    totalAssets: round2(marketValue + cash),
    marketValue,
    cash,
    accounts,
    holdings,
    // PortfolioSnapshot.fetchedAt is epoch ms (account.ts).
    fetchedAt: Date.now(),
  };
}

/**
 * Wrap capability fetchers so that when every real provider is unavailable the
 * demo dataset answers instead. Only the surfaces typed blocks demo are
 * wrapped; everything else keeps failing honestly.
 */
export function withDemoDataFallback<F extends Partial<MarketDataFetchers>>(fetchers: F): F {
  return {
    ...fetchers,
    getQuote: async (symbol) => {
      const real = fetchers.getQuote;
      if (real) {
        try {
          return await real(symbol);
        } catch {
          return demoQuoteFor(symbol);
        }
      }
      return demoQuoteFor(symbol);
    },
    getKline: async (options) => {
      const real = fetchers.getKline;
      if (real) {
        try {
          return await real(options);
        } catch {
          return demoKlinesFor(options.symbol, typeof options.limit === 'number' ? options.limit : 30);
        }
      }
      return demoKlinesFor(options.symbol, typeof options.limit === 'number' ? options.limit : 30);
    },
    getPortfolio: async () => {
      const real = fetchers.getPortfolio;
      if (real) {
        try {
          return await real();
        } catch {
          return demoPortfolioSnapshot();
        }
      }
      return demoPortfolioSnapshot();
    },
    getAccountPositions: async () => {
      const real = fetchers.getAccountPositions;
      if (real) {
        try {
          return await real();
        } catch {
          return demoPortfolioSnapshot().holdings;
        }
      }
      return demoPortfolioSnapshot().holdings;
    },
  } as F;
}

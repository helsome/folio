import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import {
  fetchQuoteAtom,
  quoteCacheAtomFamily,
  watchlistAtom,
  watchlistLatestTimestampAtom,
  watchlistMarketSourceAtom,
  watchlistQuotesAreDemoAtom,
} from './quoteAtoms';
import type { Quote } from '@finagent/core';
import { fallbackClient } from '../client';

function quote(ts: number): Quote {
  return {
    symbol: 'X',
    lastPrice: 1,
    change: 0,
    changePercent: 0,
    volume: 0,
    timestamp: ts,
    high: 1,
    low: 1,
    open: 1,
    prevClose: 1,
  };
}

describe('watchlistLatestTimestampAtom', () => {
  it('returns the newest quote timestamp across the watchlist', () => {
    const store = createStore();
    store.set(watchlistAtom, ['AAPL.US', 'TSLA.US']);
    store.set(quoteCacheAtomFamily('AAPL.US'), {
      data: quote(100),
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: false,
    });
    store.set(quoteCacheAtomFamily('TSLA.US'), {
      data: quote(300),
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: false,
    });
    expect(store.get(watchlistLatestTimestampAtom)).toBe(300);
  });

  it('is undefined when no quote has loaded yet', () => {
    const store = createStore();
    store.set(watchlistAtom, ['AAPL.US']);
    expect(store.get(watchlistLatestTimestampAtom)).toBeUndefined();
  });
});

describe('watchlistQuotesAreDemoAtom', () => {
  it('is false when the watchlist is empty or holds real data', () => {
    const store = createStore();
    store.set(watchlistAtom, []);
    expect(store.get(watchlistQuotesAreDemoAtom)).toBe(false);

    store.set(watchlistAtom, ['AAPL.US']);
    store.set(quoteCacheAtomFamily('AAPL.US'), {
      data: quote(100),
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: false,
    });
    expect(store.get(watchlistQuotesAreDemoAtom)).toBe(false);
  });

  it('is true only when every watchlist quote is sample data', () => {
    const store = createStore();
    store.set(watchlistAtom, ['AAPL.US', 'TSLA.US']);
    store.set(quoteCacheAtomFamily('AAPL.US'), {
      data: quote(100),
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: true,
    });
    store.set(quoteCacheAtomFamily('TSLA.US'), {
      data: null,
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: false,
    });
    expect(store.get(watchlistQuotesAreDemoAtom)).toBe(false);

    store.set(quoteCacheAtomFamily('TSLA.US'), {
      data: quote(300),
      timestamp: 1,
      loading: false,
      error: null,
      isDemo: true,
    });
    expect(store.get(watchlistQuotesAreDemoAtom)).toBe(true);
  });
});

describe('fetchQuoteAtom provider failures', () => {
  it('clears sample-supported symbols on failure rather than inventing prices', async () => {
    const store = createStore();
    const failingClient = {
      ...fallbackClient,
      market: {
        ...fallbackClient.market,
        getQuote: async () => ({ ok: false, error: { code: 'OFFLINE', message: 'Longbridge offline' } }),
      },
    } as unknown as typeof fallbackClient;

    const result = await store.set(fetchQuoteAtom, { client: failingClient, symbol: 'AAPL.US' });
    expect(result).toBeNull();

    const cache = store.get(quoteCacheAtomFamily('AAPL.US'));
    expect(cache.isDemo).toBe(false);
    expect(cache.data).toBeNull();
    expect(cache.timestamp).toBe(0);
    expect(cache.error).toBe('Longbridge offline');
  });

  it('keeps the honest error path for symbols without sample data', async () => {
    const store = createStore();
    const failingClient = {
      ...fallbackClient,
      market: {
        ...fallbackClient.market,
        getQuote: async () => ({ ok: false, error: { code: 'OFFLINE', message: 'Longbridge offline' } }),
      },
    } as unknown as typeof fallbackClient;

    await store.set(fetchQuoteAtom, { client: failingClient, symbol: '0700.HK' });
    const cache = store.get(quoteCacheAtomFamily('0700.HK'));
    expect(cache.isDemo).toBe(false);
    expect(cache.data).toBeNull();
    expect(cache.error).toBe('Longbridge offline');
  });
});


it.each([false, true])('keeps source and freshness honest when allFailed=%s', async allFailed => {
  const store = createStore();
  store.set(watchlistAtom, ['AAPL.US', 'TSLA.US']);
  const client = {
    ...fallbackClient, market: {
      ...fallbackClient.market,
      getQuote: async (symbol: string) => symbol === 'AAPL.US' && !allFailed
        ? { ok: true as const, data: { ...quote(100), symbol, source: { providerId: 'yahoo', providerName: 'Yahoo Finance', delayed: true } } }
        : { ok: false as const, error: { code: 'OFFLINE', message: 'Provider unavailable' } },
    },
  };
  // A failed refresh must clear a previously successful price too.
  store.set(quoteCacheAtomFamily('TSLA.US'), {
    data: { ...quote(999), symbol: 'TSLA.US' }, timestamp: 999,
    loading: false, error: null, isDemo: false,
  });
  for (const symbol of store.get(watchlistAtom)) await store.set(fetchQuoteAtom, { client, symbol });
  expect(store.get(quoteCacheAtomFamily('TSLA.US'))).toMatchObject({ data: null, timestamp: 0, isDemo: false, error: 'Provider unavailable' });
  expect(store.get(watchlistLatestTimestampAtom)).toBe(allFailed ? undefined : 100);
  expect(store.get(watchlistMarketSourceAtom)).toEqual(allFailed ? { providerName: undefined, delayed: false } : { providerName: 'Yahoo Finance', delayed: true });
  expect(store.get(watchlistQuotesAreDemoAtom)).toBe(false);
});

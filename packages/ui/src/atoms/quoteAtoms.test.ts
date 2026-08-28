import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import {
  fetchQuoteAtom,
  quoteCacheAtomFamily,
  watchlistAtom,
  watchlistLatestTimestampAtom,
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

describe('fetchQuoteAtom demo fallback', () => {
  it('falls back to badged sample data when the provider fails', async () => {
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
    expect(cache.isDemo).toBe(true);
    expect(cache.data).not.toBeNull();
    expect(cache.data?.symbol).toBe('AAPL.US');
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

import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { quoteCacheAtomFamily, watchlistAtom, watchlistLatestTimestampAtom } from './quoteAtoms';
import type { Quote } from '@finagent/core';

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
    });
    store.set(quoteCacheAtomFamily('TSLA.US'), {
      data: quote(300),
      timestamp: 1,
      loading: false,
      error: null,
    });
    expect(store.get(watchlistLatestTimestampAtom)).toBe(300);
  });

  it('is undefined when no quote has loaded yet', () => {
    const store = createStore();
    store.set(watchlistAtom, ['AAPL.US']);
    expect(store.get(watchlistLatestTimestampAtom)).toBeUndefined();
  });
});

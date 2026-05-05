import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Quote } from '@finagent/core';
import type { FinagentClient } from '../client';

const CACHE_TTL = 30 * 1000; // 30 seconds

interface QuoteCache {
  data: Quote | null;
  timestamp: number;
  loading: boolean;
  error: string | null;
}

// Quote cache atom family
export const quoteCacheAtomFamily = atomFamily((symbol: string) =>
  atom<QuoteCache>({
    data: null,
    timestamp: 0,
    loading: false,
    error: null,
  })
);

// Watchlist atoms
export const watchlistAtom = atom<string[]>(['AAPL.US', 'TSLA.US', 'NVDA.US']);

// Add symbol to watchlist
export const addToWatchlistAtom = atom(
  null,
  (_get, set, symbol: string) => {
    set(watchlistAtom, (list) => {
      if (list.includes(symbol)) return list;
      return [...list, symbol];
    });
  }
);

// Remove symbol from watchlist
export const removeFromWatchlistAtom = atom(
  null,
  (_get, set, symbol: string) => {
    set(watchlistAtom, (list) => list.filter((s) => s !== symbol));
  }
);

// Fetch quote action
export const fetchQuoteAtom = atom(
  null,
  async (_get, set, input: { client: FinagentClient; symbol: string }) => {
    const { client, symbol } = input;
    // Set loading state
    set(quoteCacheAtomFamily(symbol), (cache) => ({
      ...cache,
      loading: true,
      error: null,
    }));

    try {
      const result = await client.market.getQuote(symbol);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const quote = result.data;

      set(quoteCacheAtomFamily(symbol), {
        data: quote,
        timestamp: Date.now(),
        loading: false,
        error: null,
      });

      return quote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch quote';
      set(quoteCacheAtomFamily(symbol), (cache) => ({
        ...cache,
        loading: false,
        error: errorMessage,
      }));
      return null;
    }
  }
);

// Check if quote cache is stale
export const isQuoteStaleAtom = atomFamily((symbol: string) =>
  atom((get) => {
    const cache = get(quoteCacheAtomFamily(symbol));
    if (!cache.data) return true;
    return Date.now() - cache.timestamp > CACHE_TTL;
  })
);

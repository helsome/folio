import { atom } from 'jotai';
import type { Portfolio } from '@finagent/core';
import type { FinagentClient } from '../client';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

interface PortfolioCache {
  data: Portfolio | null;
  timestamp: number;
  loading: boolean;
  error: string | null;
}

export const portfolioCacheAtom = atom<PortfolioCache>({
  data: null,
  timestamp: 0,
  loading: false,
  error: null,
});

export const fetchPortfolioAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    set(portfolioCacheAtom, (cache) => ({
      ...cache,
      loading: true,
      error: null,
    }));

    try {
      const result = await client.market.getPortfolio();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const portfolio = result.data;

      set(portfolioCacheAtom, {
        data: portfolio,
        timestamp: Date.now(),
        loading: false,
        error: null,
      });

      return portfolio;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch portfolio';
      set(portfolioCacheAtom, (cache) => ({
        ...cache,
        loading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }
);

export const isPortfolioStaleAtom = atom((get) => {
  const cache = get(portfolioCacheAtom);
  if (!cache.data) return true;
  return Date.now() - cache.timestamp > CACHE_TTL;
});

import { atom } from 'jotai';
import type { Holding, PortfolioAccount, PortfolioFailure, PortfolioSnapshot } from '@finagent/core';
import type { FinagentClient } from '../client';
import { portfolioFailureFromError, portfolioFailureFromSnapshot } from '../lib/portfolioFailure';

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

interface PortfolioCache {
  data: PortfolioSnapshot | null;
  /** Classified failure (spec §19): empty/partial derive from data, the rest from the IPC error. */
  failure: PortfolioFailure | null;
  timestamp: number;
  loading: boolean;
  error: string | null;
}

export const portfolioCacheAtom = atom<PortfolioCache>({
  data: null,
  failure: null,
  timestamp: 0,
  loading: false,
  error: null,
});

export const fetchPortfolioAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    set(portfolioCacheAtom, (cache) => ({ ...cache, loading: true, error: null }));

    try {
      const result = await client.market.getPortfolio();
      if (!result.ok) {
        const failure = portfolioFailureFromError(result.error);
        set(portfolioCacheAtom, (cache) => ({
          ...cache,
          loading: false,
          error: failure.message,
          failure,
        }));
        throw new Error(failure.message);
      }

      const snapshot = result.data;
      set(portfolioCacheAtom, {
        data: snapshot,
        failure: portfolioFailureFromSnapshot(snapshot) ?? null,
        timestamp: Date.now(),
        loading: false,
        error: null,
      });
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch portfolio';
      set(portfolioCacheAtom, (cache) => ({ ...cache, loading: false, error: message }));
      throw error;
    }
  }
);

export const isPortfolioStaleAtom = atom((get) => {
  const cache = get(portfolioCacheAtom);
  if (!cache.data) return true;
  return Date.now() - cache.timestamp > CACHE_TTL;
});

// ── Account selector (spec §18) ────────────────────────────────────────────

/** Selected account id; `null` = "All accounts" (the combined overview). */
export const selectedAccountIdAtom = atom<string | null>(null);

/** Derive the market (US/HK/…) from a symbol suffix, e.g. `1810.HK` → `HK`. */
export function holdingMarket(symbol: string): string | undefined {
  const dot = symbol.lastIndexOf('.');
  if (dot < 0 || dot === symbol.length - 1) return undefined;
  return symbol.slice(dot + 1).toUpperCase();
}

/** A view scoped to the selected account (or the combined overview). */
export interface PortfolioView {
  snapshot: PortfolioSnapshot;
  accounts: PortfolioAccount[];
  account: PortfolioAccount | null;
  holdings: Holding[];
  baseCurrency?: string;
  totalAssets?: number;
  marketValue?: number;
  cash?: number;
  totalPnL?: number;
  todayPnL?: number;
}

export const portfolioViewAtom = atom<PortfolioView | null>((get) => {
  const snapshot = get(portfolioCacheAtom).data;
  if (!snapshot) return null;

  const selectedId = get(selectedAccountIdAtom);
  const account = selectedId === null
    ? null
    : snapshot.accounts.find((a) => a.id === selectedId) ?? null;

  const holdings = account === null
    ? snapshot.holdings
    : snapshot.holdings.filter((h) => holdingMarket(h.symbol) === account.market);

  return {
    snapshot,
    accounts: snapshot.accounts,
    account,
    holdings,
    baseCurrency: account?.currency ?? snapshot.baseCurrency,
    totalAssets: account ? account.netAssets : snapshot.totalAssets,
    marketValue: account ? account.marketValue : snapshot.marketValue,
    cash: account ? account.cash : snapshot.cash,
    totalPnL: account ? account.pnl : snapshot.totalPnL,
    todayPnL: account ? account.todayPnL : snapshot.todayPnL,
  };
});

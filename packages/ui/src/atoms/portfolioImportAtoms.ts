import { atom } from 'jotai';
import type { ManualPortfolio } from '@finagent/core';
import { listManualPortfolios } from '../client/portfolioImport';

/**
 * Manual portfolio state (spec §49).
 *
 * Manual portfolios are a SEPARATE account kind from broker-synced accounts.
 * The list is loaded over IPC (`portfolio:listManual`) into
 * `manualPortfoliosAtom`; `refreshManualPortfoliosAtom` re-fetches after an
 * import is confirmed. The channel is wired by the Lead — until then the
 * loader degrades to [] and the UI simply shows no manual accounts.
 */

export interface ManualPortfoliosState {
  portfolios: ManualPortfolio[];
  loading: boolean;
  error: string | null;
}

export const manualPortfoliosAtom = atom<ManualPortfoliosState>({
  portfolios: [],
  loading: false,
  error: null,
});

/** Fetch manual portfolios; results land in `manualPortfoliosAtom`. */
export const refreshManualPortfoliosAtom = atom(null, async (_get, set) => {
  set(manualPortfoliosAtom, (state) => ({ ...state, loading: true, error: null }));
  try {
    const portfolios = await listManualPortfolios();
    set(manualPortfoliosAtom, { portfolios, loading: false, error: null });
    return portfolios;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not load manual portfolios';
    set(manualPortfoliosAtom, (state) => ({ ...state, loading: false, error: message }));
    throw error;
  }
});

export type { ManualPortfolio } from '@finagent/core';

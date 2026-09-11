import { persistedAtom } from '../lib/persistedPrefs';
import type { ContextSelection, PortfolioPositionContext } from '@finagent/core';
import type { PortfolioView } from './portfolioAtoms';

export interface AgentContextChoices { watchlist: boolean; portfolio: boolean }
export const agentContextChoicesAtom = persistedAtom<AgentContextChoices>('agentContextChoices', { watchlist: false, portfolio: false });

interface ContextApi {
  context?: {
    saveWatchlist?: (input: unknown) => Promise<unknown>;
    savePortfolio?: (input: unknown) => Promise<unknown>;
  };
}

/** Sync only the explicitly selected context and return ids safe to pass with the run. */
export async function syncSelectedAgentContext(
  choices: AgentContextChoices,
  watchlist: string[],
  portfolio: PortfolioView | null
): Promise<ContextSelection[]> {
  const api = (window as { electronAPI?: ContextApi }).electronAPI?.context;
  const selections: ContextSelection[] = [];
  if ((choices.watchlist || choices.portfolio) && !api) throw new Error('Selected context storage is unavailable.');
  if (choices.watchlist && watchlist.length > 0 && api?.saveWatchlist) {
    const result = await api.saveWatchlist({ id: 'default-watchlist', name: 'Watchlist', instruments: watchlist.map((instrumentId) => ({ instrumentId })) });
    if (!isIpcSuccess(result)) throw ipcFailure(result, 'watchlist');
    selections.push({ kind: 'watchlist', id: 'default-watchlist' });
  } else if (choices.watchlist) {
    throw new Error('The selected watchlist is empty.');
  }
  if (choices.portfolio && portfolio && portfolio.holdings.length > 0 && api?.savePortfolio) {
    const positions: PortfolioPositionContext[] = portfolio.holdings.map((holding) => ({
      instrumentId: holding.symbol,
      nativeCurrency: holding.currency ?? portfolio.baseCurrency ?? 'USD',
      ...(holding.quantity !== undefined ? { quantity: holding.quantity } : {}),
      ...(holding.costPrice !== undefined ? { costBasis: holding.costPrice } : {}),
    }));
    const result = await api.savePortfolio({ id: 'active-portfolio', name: portfolio.account?.name ?? 'Portfolio', positions, asOf: portfolio.snapshot.marketTime ?? portfolio.snapshot.fetchedAt });
    if (!isIpcSuccess(result)) throw ipcFailure(result, 'portfolio');
    selections.push({ kind: 'portfolio', id: 'active-portfolio' });
  } else if (choices.portfolio) {
    throw new Error('The selected portfolio is empty.');
  }
  return selections;
}

function ipcFailure(value: unknown, label: string): Error {
  const message = value && typeof value === 'object' && 'error' in value && (value as { error?: { message?: unknown } }).error?.message;
  return new Error(typeof message === 'string' ? message : `Could not save the selected ${label}.`);
}

function isIpcSuccess(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true);
}

import { atom } from 'jotai';
import type { Comparison } from '@finagent/core';

/**
 * Symbols the Compare workspace is focused on (2–4). This is the single source
 * of truth for `WorkspaceContext.comparisonSymbols`, so the agent context can
 * cite exactly what is being compared.
 */
export const compareSymbolsAtom = atom<string[]>([]);

export interface ComparisonState {
  data: Comparison | null;
  loading: boolean;
  error: string | null;
}

export const comparisonStateAtom = atom<ComparisonState>({
  data: null,
  loading: false,
  error: null,
});

/** Pure: replace one symbol in the compare set (used by the 2–4 picker). */
export function withComparisonSymbols(current: string[], symbol: string, add: boolean): string[] {
  if (add) {
    if (current.includes(symbol)) return current;
    if (current.length >= 4) return current;
    return [...current, symbol];
  }
  return current.filter((s) => s !== symbol);
}

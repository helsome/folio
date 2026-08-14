import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { InvestmentThesis, ResearchReport, ThesisImpact } from '@finagent/core';

/**
 * Thesis workspace state. The actual reads/writes go through the main process
 * (not-yet-wired IPC), so the loaders in `client/thesis.ts` degrade to empty
 * until the Lead wires the channel — the panels then render their empty states.
 */

/** All theses loaded for the active symbol (most-recent first). */
export const thesesAtom = atom<InvestmentThesis[]>([]);

/** Impact history keyed by symbol. */
export const thesisImpactsAtom = atom<Record<string, ThesisImpact[]>>({});

/** Latest research report per symbol — its presence gates "Save as Thesis". */
export const researchReportAtomFamily = atomFamily((symbol: string) =>
  atom<ResearchReport | null>(null)
);

export interface ThesisLoadState {
  loading: boolean;
  error: string | null;
}

export const thesisLoadStateAtom = atom<ThesisLoadState>({ loading: false, error: null });

/** Pure selectors (unit-testable without a store). */
export function getThesesForSymbol(theses: InvestmentThesis[], symbol: string): InvestmentThesis[] {
  return theses.filter((thesis) => thesis.symbol === symbol);
}

export function getImpactsForSymbol(
  impacts: Record<string, ThesisImpact[]>,
  symbol: string
): ThesisImpact[] {
  return impacts[symbol] ?? [];
}

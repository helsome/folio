import { atom } from 'jotai';
import type { ResearchOpinion, ResearchOutcome } from '@finagent/core';
import { unwrapIpcResult } from '../client/unwrap';

/**
 * Outcome view state (spec §29–38).
 *
 * Opinions and outcomes live in the main process (OutcomeService); the UI
 * hydrates over IPC. The main process answers with the `{ ok, data | error }`
 * envelope; every loader below unwraps it and degrades to an empty result
 * when the channel is not wired yet.
 */

/** Opinions snapshotted from reports, newest first. */
export const opinionsAtom = atom<ResearchOpinion[]>([]);

/** Evaluation results, newest first. */
export const outcomesAtom = atom<ResearchOutcome[]>([]);

/** Loading flag for a running refresh. */
export const outcomeLoadingAtom = atom<boolean>(false);

export type { ResearchOpinion, ResearchOutcome };

/** Minimal shape of the electron API surface we consume. */
interface OutcomeElectronApi {
  outcome?: {
    listOpinions?: (input: { symbol?: string }) => Promise<unknown>;
    listOutcomes?: (input: { symbol?: string }) => Promise<unknown>;
    evaluateDue?: () => Promise<unknown>;
  };
}

function api(): OutcomeElectronApi['outcome'] {
  const electronApi = (window as { electronAPI?: OutcomeElectronApi }).electronAPI;
  return electronApi?.outcome;
}

/** Hydrate opinions for a symbol (or all when symbol is undefined). */
export async function loadOpinions(symbol?: string): Promise<ResearchOpinion[]> {
  try {
    const outcome = api();
    if (!outcome?.listOpinions) return [];
    return unwrapIpcResult<ResearchOpinion[]>(await outcome.listOpinions({ symbol })) ?? [];
  } catch {
    return [];
  }
}

/** Hydrate outcomes for a symbol (or all when symbol is undefined). */
export async function loadOutcomes(symbol?: string): Promise<ResearchOutcome[]> {
  try {
    const outcome = api();
    if (!outcome?.listOutcomes) return [];
    return unwrapIpcResult<ResearchOutcome[]>(await outcome.listOutcomes({ symbol })) ?? [];
  } catch {
    return [];
  }
}

/**
 * Manually trigger due-opinion evaluation (tests/debug). Returns the number
 * of outcomes produced; 0 when the channel is unwired.
 */
export async function runEvaluateDue(): Promise<number> {
  try {
    const outcome = api();
    if (!outcome?.evaluateDue) return 0;
    const result = unwrapIpcResult<ResearchOutcome[] | number>(await outcome.evaluateDue());
    if (typeof result === 'number') return result;
    return Array.isArray(result) ? result.length : 0;
  } catch {
    return 0;
  }
}

import { atom } from 'jotai';
import type { ResearchDiff } from '@finagent/core';
import { unwrapIpcResult } from '../client/unwrap';

/**
 * Research diff view state (What Changed section).
 *
 * The diff for a symbol lives in the main process (ResearchDiffRepository);
 * the UI hydrates it over IPC with the same `{ ok, data | error }` envelope as
 * every other research channel.
 */

export interface ResearchDiffState {
  loading: boolean;
  /** The latest diff for the rendered symbol; null when no previous report exists. */
  diff: ResearchDiff | null;
}

export const researchDiffAtom = atom<ResearchDiffState>({ loading: false, diff: null });

/** Minimal shape of the electron API surface we consume. */
interface DiffElectronApi {
  research?: {
    getDiff?: (input: { symbol: string }) => Promise<unknown>;
  };
}

function api(): DiffElectronApi['research'] {
  const electronApi = (window as { electronAPI?: DiffElectronApi }).electronAPI;
  return electronApi?.research;
}

/**
 * Fetch the latest diff for a symbol. Returns undefined when unwired or when
 * the symbol has no previous report (the What Changed section then hides).
 */
export async function loadResearchDiff(symbol: string): Promise<ResearchDiff | undefined> {
  try {
    const research = api();
    if (!research?.getDiff) return undefined;
    return (
      unwrapIpcResult<ResearchDiff | undefined>(await research.getDiff({ symbol: symbol.toUpperCase() })) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

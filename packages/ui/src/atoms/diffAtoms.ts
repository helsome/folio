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
  /** The selected report's diff; null when no matching comparison is available. */
  diff: ResearchDiff | null;
}

export const researchDiffAtom = atom<ResearchDiffState>({ loading: false, diff: null });

/** Minimal shape of the electron API surface we consume. */
interface DiffElectronApi {
  research?: {
    getDiff?: (input: { symbol: string; reportId?: string }) => Promise<unknown>;
  };
}

function api(): DiffElectronApi['research'] {
  const electronApi = (window as { electronAPI?: DiffElectronApi }).electronAPI;
  return electronApi?.research;
}

/**
 * Fetch a report's comparison, or the latest report when no id is supplied.
 * Returns undefined when the channel or matching comparison is unavailable.
 */
export async function loadResearchDiff(symbol: string, reportId?: string): Promise<ResearchDiff | undefined> {
  try {
    const research = api();
    if (!research?.getDiff) return undefined;
    return (
      unwrapIpcResult<ResearchDiff | undefined>(await research.getDiff({ symbol: symbol.toUpperCase(), reportId })) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

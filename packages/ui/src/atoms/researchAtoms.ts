import { atom, type SetStateAction } from 'jotai';
import type { ResearchReport, ResearchRunSummary, ResearchRunStatus } from '@finagent/core';
import { unwrapIpcResult } from '../client/unwrap';
import { activeSymbolAtom } from './workspaceAtoms';
import { researchSelectionAtom } from './researchSelectionAtoms';

export const selectedReportIdAtom = atom(
  (get) => {
    const selection = get(researchSelectionAtom);
    return selection?.symbol === get(activeSymbolAtom) ? selection?.reportId ?? null : null;
  },
  (get, set, next: SetStateAction<string | null>) => {
    const reportId = typeof next === 'function' ? next(get(selectedReportIdAtom)) : next;
    const symbol = get(activeSymbolAtom);
    set(researchSelectionAtom, symbol && reportId ? { symbol, reportId } : null);
  }
);

/**
 * Deep Research view state.
 *
 * Runs and reports live in the main process (ResearchService); the UI hydrates
 * over IPC. The main process answers with the `{ ok, data | error }` envelope;
 * every loader below unwraps it and degrades to an empty result on failure.
 */

/** Recent research runs, newest first (hydrated from `research:listRuns`). */
export const researchRunsAtom = atom<ResearchRunSummary[]>([]);

/** The report currently shown in the report view. */
const loadedReportAtom = atom<ResearchReport | null>(null);
export const researchReportAtom = atom(
  (get) => {
    const report = get(loadedReportAtom);
    return report?.symbol === get(activeSymbolAtom) && report?.id === get(selectedReportIdAtom) ? report : null;
  },
  (_get, set, report: ResearchReport | null) => set(loadedReportAtom, report)
);

/** Reports available for the active symbol (hydrated from `research:listReports`). */
export const symbolReportsAtom = atom<ResearchReport[]>([]);

/** Loading flag for a running refresh. */
export const researchLoadingAtom = atom<boolean>(false);

export type { ResearchReport, ResearchRunSummary, ResearchRunStatus };

/** Minimal shape of the electron API surface we consume. */
interface ResearchElectronApi {
  research?: {
    start?: (input: ResearchStartInput) => Promise<unknown>;
    cancel?: (input: { runId: string }) => Promise<unknown>;
    listRuns?: () => Promise<unknown>;
    getRun?: (input: { runId: string }) => Promise<unknown>;
    listReports?: (input: { symbol?: string }) => Promise<unknown>;
    getReport?: (input: { reportId: string }) => Promise<unknown>;
  };
}

function api(): ResearchElectronApi['research'] {
  const electronApi = (window as { electronAPI?: ResearchElectronApi }).electronAPI;
  return electronApi?.research;
}

/** Input for a Deep Research start. `strategyId` is optional (V5 presets). */
export interface ResearchStartInput {
  symbol: string;
  strategyId?: string;
}

/**
 * Start a Deep Research run for a symbol with an optional research strategy.
 * Returns undefined when unwired.
 */
export async function startResearch(
  input: ResearchStartInput
): Promise<ResearchRunSummary | undefined> {
  try {
    const research = api();
    if (!research?.start) return undefined;
    return (
      unwrapIpcResult<ResearchRunSummary>(
        await research.start({ symbol: input.symbol.toUpperCase(), strategyId: input.strategyId })
      ) ?? undefined
    );
  } catch {
    return undefined;
  }
}

/** Cancel an active run. */
export async function cancelResearch(runId: string): Promise<void> {
  try {
    await api()?.cancel?.({ runId });
  } catch {
    // Graceful: the main process settles the run either way.
  }
}

/** Hydrate the recent run list. */
export async function loadResearchRuns(): Promise<ResearchRunSummary[]> {
  try {
    const research = api();
    if (!research?.listRuns) return [];
    return unwrapIpcResult<ResearchRunSummary[]>(await research.listRuns()) ?? [];
  } catch {
    return [];
  }
}

/** Fetch one run's latest summary (progress polling). */
export async function loadResearchRun(runId: string): Promise<ResearchRunSummary | undefined> {
  try {
    return unwrapIpcResult<ResearchRunSummary | undefined>(await api()?.getRun?.({ runId })) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Hydrate reports for a symbol (or all when symbol is undefined). */
export async function loadSymbolReports(symbol?: string): Promise<ResearchReport[]> {
  try {
    const research = api();
    if (!research?.listReports) return [];
    return unwrapIpcResult<ResearchReport[]>(await research.listReports({ symbol })) ?? [];
  } catch {
    return [];
  }
}

/** Fetch a full report by id. */
export async function loadResearchReport(reportId: string): Promise<ResearchReport | undefined> {
  try {
    return unwrapIpcResult<ResearchReport | undefined>(await api()?.getReport?.({ reportId })) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Terminal statuses — a run in one of these stops progress polling. */
export const TERMINAL_RUN_STATUSES: Partial<Record<ResearchRunStatus, true>> = {
  interrupted: true,
  completed: true,
  partial: true,
  failed: true,
  cancelled: true,
};

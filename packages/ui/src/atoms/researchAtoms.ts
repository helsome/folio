import { atom } from 'jotai';
import type { ResearchReport, ResearchRunSummary, ResearchRunStatus } from '@finagent/core';

/**
 * Deep Research view state.
 *
 * Runs and reports live in the main process (ResearchService); the UI hydrates
 * over IPC. The channels are wired by the Lead at integration; until then the
 * loaders degrade gracefully so the views never crash.
 */

/** Recent research runs, newest first (hydrated from `research:listRuns`). */
export const researchRunsAtom = atom<ResearchRunSummary[]>([]);

/** The report currently shown in the report view. */
export const researchReportAtom = atom<ResearchReport | null>(null);

/** Reports available for the active symbol (hydrated from `research:listReports`). */
export const symbolReportsAtom = atom<ResearchReport[]>([]);

/** Loading flag for a running refresh. */
export const researchLoadingAtom = atom<boolean>(false);

export type { ResearchReport, ResearchRunSummary, ResearchRunStatus };

/** Minimal shape of the (not-yet-wired) electron API surface we consume. */
interface ResearchElectronApi {
  research?: {
    start?: (input: { symbol: string }) => Promise<ResearchRunSummary>;
    cancel?: (input: { runId: string }) => Promise<void>;
    listRuns?: () => Promise<ResearchRunSummary[]>;
    getRun?: (input: { runId: string }) => Promise<ResearchRunSummary | undefined>;
    listReports?: (input: { symbol?: string }) => Promise<ResearchReport[]>;
    getReport?: (input: { reportId: string }) => Promise<ResearchReport | undefined>;
  };
}

function api(): ResearchElectronApi['research'] {
  const electronApi = (window as { electronAPI?: ResearchElectronApi }).electronAPI;
  return electronApi?.research;
}

/** Start a Deep Research run for a symbol. Returns undefined when unwired. */
export async function startResearch(symbol: string): Promise<ResearchRunSummary | undefined> {
  try {
    const research = api();
    if (!research?.start) return undefined;
    return await research.start({ symbol: symbol.toUpperCase() });
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
    return await research.listRuns();
  } catch {
    return [];
  }
}

/** Fetch one run's latest summary (progress polling). */
export async function loadResearchRun(runId: string): Promise<ResearchRunSummary | undefined> {
  try {
    return await api()?.getRun?.({ runId });
  } catch {
    return undefined;
  }
}

/** Hydrate reports for a symbol (or all when symbol is undefined). */
export async function loadSymbolReports(symbol?: string): Promise<ResearchReport[]> {
  try {
    const research = api();
    if (!research?.listReports) return [];
    return await research.listReports({ symbol });
  } catch {
    return [];
  }
}

/** Fetch a full report by id. */
export async function loadResearchReport(reportId: string): Promise<ResearchReport | undefined> {
  try {
    return await api()?.getReport?.({ reportId });
  } catch {
    return undefined;
  }
}

/** Terminal statuses — a run in one of these stops progress polling. */
export const TERMINAL_RUN_STATUSES: Partial<Record<ResearchRunStatus, true>> = {
  completed: true,
  partial: true,
  failed: true,
  cancelled: true,
};

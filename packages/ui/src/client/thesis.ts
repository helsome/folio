import type { InvestmentThesis, ResearchReport, ThesisImpact } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';

/**
 * Defensive thesis client. The channel (`window.electronAPI.thesis.*`) answers
 * with the `{ ok, data | error }` envelope; every loader unwraps it and
 * degrades to an empty/null result so the panels render their graceful
 * "no thesis"/"no report" states instead of crashing.
 */

interface ThesisElectronApi {
  thesis?: {
    list?: (symbol?: string) => Promise<unknown>;
    getReport?: (symbol: string) => Promise<unknown>;
    saveFromReport?: (symbol: string) => Promise<unknown>;
    reEvaluate?: (symbol: string) => Promise<unknown>;
    update?: (thesis: InvestmentThesis) => Promise<unknown>;
    listImpacts?: (symbol: string) => Promise<unknown>;
  };
}

function thesisApi(): ThesisElectronApi['thesis'] | undefined {
  return (window as { electronAPI?: ThesisElectronApi }).electronAPI?.thesis;
}

export async function loadTheses(symbol?: string): Promise<InvestmentThesis[]> {
  try {
    const loader = thesisApi()?.list;
    if (typeof loader !== 'function') return [];
    return unwrapIpcResult<InvestmentThesis[]>(await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}

export async function loadResearchReport(symbol: string): Promise<ResearchReport | null> {
  try {
    const loader = thesisApi()?.getReport;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<ResearchReport | null>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function saveThesisFromReport(symbol: string): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi()?.saveFromReport;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<InvestmentThesis>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function reEvaluateThesis(symbol: string): Promise<ThesisImpact | null> {
  try {
    const loader = thesisApi()?.reEvaluate;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<ThesisImpact>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function updateThesis(thesis: InvestmentThesis): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi()?.update;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<InvestmentThesis>(await loader(thesis));
  } catch {
    return null;
  }
}

export async function loadImpacts(symbol: string): Promise<ThesisImpact[]> {
  try {
    const loader = thesisApi()?.listImpacts;
    if (typeof loader !== 'function') return [];
    return unwrapIpcResult<ThesisImpact[]>(await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}

import type { InvestmentThesis, ResearchReport, ThesisImpact } from '@finagent/core';

/**
 * Defensive thesis client. The real channel (`window.electronAPI.thesis.*`) is
 * wired by the Lead at integration; until then every loader degrades to an
 * empty result so the panels render their graceful "no thesis"/"no report"
 * states instead of crashing.
 */

/** Minimal shape of the (not-yet-wired) electron API surface we consume. */
interface ThesisElectronApi {
  thesis?: {
    list?: (symbol?: string) => Promise<InvestmentThesis[]>;
    getReport?: (symbol: string) => Promise<ResearchReport | null>;
    saveFromReport?: (symbol: string) => Promise<InvestmentThesis>;
    reEvaluate?: (symbol: string) => Promise<ThesisImpact>;
    update?: (thesis: InvestmentThesis) => Promise<InvestmentThesis>;
    listImpacts?: (symbol: string) => Promise<ThesisImpact[]>;
  };
}

function thesisApi(): ThesisElectronApi['thesis'] | undefined {
  return (window as { electronAPI?: ThesisElectronApi }).electronAPI?.thesis;
}

export async function loadTheses(symbol?: string): Promise<InvestmentThesis[]> {
  try {
    const loader = thesisApi()?.list;
    if (typeof loader !== 'function') return [];
    return (await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}

export async function loadResearchReport(symbol: string): Promise<ResearchReport | null> {
  try {
    const loader = thesisApi()?.getReport;
    if (typeof loader !== 'function') return null;
    return await loader(symbol);
  } catch {
    return null;
  }
}

export async function saveThesisFromReport(symbol: string): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi()?.saveFromReport;
    if (typeof loader !== 'function') return null;
    return await loader(symbol);
  } catch {
    return null;
  }
}

export async function reEvaluateThesis(symbol: string): Promise<ThesisImpact | null> {
  try {
    const loader = thesisApi()?.reEvaluate;
    if (typeof loader !== 'function') return null;
    return await loader(symbol);
  } catch {
    return null;
  }
}

export async function updateThesis(thesis: InvestmentThesis): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi()?.update;
    if (typeof loader !== 'function') return null;
    return await loader(thesis);
  } catch {
    return null;
  }
}

export async function loadImpacts(symbol: string): Promise<ThesisImpact[]> {
  try {
    const loader = thesisApi()?.listImpacts;
    if (typeof loader !== 'function') return [];
    return (await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}

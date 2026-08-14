import { atom } from 'jotai';
import type { PortfolioRiskReport, RiskSeverity } from '@finagent/core';
import { loadPortfolioRiskReport } from '../client/portfolio-risk';

/**
 * Portfolio risk view state.
 *
 * Analysis is computed in the main process (registry × fetchers) and exposed
 * to the UI over IPC. The channel (`window.electronAPI.portfolioRisk.analyze()`)
 * is not wired yet, so the loader degrades to `null` until the Lead adds it —
 * the panel then renders the graceful empty state.
 */

export interface PortfolioRiskCache {
  report: PortfolioRiskReport | null;
  loading: boolean;
  error: string | null;
}

export const portfolioRiskCacheAtom = atom<PortfolioRiskCache>({
  report: null,
  loading: false,
  error: null,
});

/** Trigger a fresh analysis; results land in `portfolioRiskCacheAtom`. */
export const analyzePortfolioRiskAtom = atom(null, async (_get, set) => {
  set(portfolioRiskCacheAtom, (cache) => ({ ...cache, loading: true, error: null }));
  try {
    const report = await loadPortfolioRiskReport();
    set(portfolioRiskCacheAtom, { report, loading: false, error: null });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Portfolio risk analysis failed';
    set(portfolioRiskCacheAtom, (cache) => ({ ...cache, loading: false, error: message }));
    throw error;
  }
});

/** Clear the cached report so the panel returns to its empty state. */
export const resetPortfolioRiskAtom = atom(null, (_get, set) => {
  set(portfolioRiskCacheAtom, { report: null, loading: false, error: null });
});

/** Visual presentation of a risk severity (pure — unit-tested). */
export interface SeverityVisual {
  tone: 'high' | 'medium' | 'low';
  color: string;
  label: string;
}

export function severityVisual(severity: RiskSeverity): SeverityVisual {
  switch (severity) {
    case 'high':
      return { tone: 'high', color: 'var(--mac-red)', label: 'High' };
    case 'medium':
      return { tone: 'medium', color: 'var(--mac-yellow)', label: 'Medium' };
    case 'low':
    default:
      return { tone: 'low', color: 'var(--mac-green)', label: 'Low' };
  }
}

export type { PortfolioRiskReport, RiskSeverity } from '@finagent/core';

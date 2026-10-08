import { atom } from 'jotai';
import type { PortfolioRiskReport, RiskSeverity } from '@finagent/core';
import { loadPortfolioRiskReport } from '../client/portfolio-risk';

/**
 * Portfolio risk view state.
 *
 * Analysis is computed in the main process (registry × fetchers) and exposed
 * to the UI over IPC (`portfolioRisk:analyze` →
 * `window.electronAPI.portfolioRisk.analyze()`). The loader returns `null`
 * when the bridge is unavailable or the call fails, so the panel renders its
 * graceful empty state.
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
  /** i18n key under `portfolio.severity.*`; the caller resolves it with `t()`. */
  labelKey: string;
}

export function severityVisual(severity: RiskSeverity): SeverityVisual {
  switch (severity) {
    case 'high':
      return { tone: 'high', color: 'var(--mac-red)', labelKey: 'portfolio.severity.high' };
    case 'medium':
      return { tone: 'medium', color: 'var(--mac-yellow)', labelKey: 'portfolio.severity.medium' };
    case 'low':
    default:
      return { tone: 'low', color: 'var(--mac-green)', labelKey: 'portfolio.severity.low' };
  }
}

export type { PortfolioRiskReport, RiskSeverity } from '@finagent/core';

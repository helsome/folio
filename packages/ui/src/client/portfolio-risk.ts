import type { PortfolioRiskReport } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';

/**
 * Defensive loader for the portfolio-risk analysis channel.
 *
 * Analysis runs in the main process (`PortfolioRiskService`) over IPC; the
 * loader unwraps the `{ ok, data | error }` envelope and returns null on any
 * failure so the UI degrades to a graceful empty state.
 */

interface PortfolioRiskElectronApi {
  portfolioRisk?: {
    analyze?: () => Promise<unknown>;
  };
}

export async function loadPortfolioRiskReport(): Promise<PortfolioRiskReport | null> {
  try {
    const api = (window as { electronAPI?: PortfolioRiskElectronApi }).electronAPI;
    const analyze = api?.portfolioRisk?.analyze;
    if (typeof analyze !== 'function') return null;
    return unwrapIpcResult<PortfolioRiskReport>(await analyze());
  } catch {
    return null;
  }
}

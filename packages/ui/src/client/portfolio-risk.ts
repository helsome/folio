import type { PortfolioRiskReport } from '@finagent/core';

/**
 * Defensive loader for the portfolio-risk analysis channel.
 *
 * Analysis runs in the main process (`PortfolioRiskService`) and is exposed
 * over IPC. The channel (`window.electronAPI.portfolioRisk.analyze()`) is not
 * wired yet — the loader returns `null` (graceful empty) until the Lead adds
 * it, so the UI never crashes before integration.
 */

/** Minimal shape of the (not-yet-wired) electron API surface we consume. */
interface PortfolioRiskElectronApi {
  portfolioRisk?: {
    analyze?: () => Promise<PortfolioRiskReport>;
  };
}

export async function loadPortfolioRiskReport(): Promise<PortfolioRiskReport | null> {
  try {
    const api = (window as { electronAPI?: PortfolioRiskElectronApi }).electronAPI;
    const analyze = api?.portfolioRisk?.analyze;
    if (typeof analyze !== 'function') return null;
    return await analyze();
  } catch {
    return null;
  }
}

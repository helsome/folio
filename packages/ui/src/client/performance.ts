import type { PerformanceHorizon, SkillPerformance, StrategyPerformance } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';

/**
 * Defensive loader for the V5 performance IPC surface
 * (`performance:skill` / `performance:strategy`).
 *
 * Aggregation runs in the main process (PerformanceService over the outcome
 * repository); the loader unwraps the `{ ok, data | error }` envelope and
 * degrades to `[]` when the channel is unwired, so the Performance view
 * renders its insufficient-data / empty states instead of crashing.
 */

interface PerformanceElectronApi {
  performance?: {
    skill?: (input: { horizon: PerformanceHorizon }) => Promise<unknown>;
    strategy?: (input: { horizon: PerformanceHorizon }) => Promise<unknown>;
  };
}

function api(): PerformanceElectronApi['performance'] {
  const electronApi = (window as { electronAPI?: PerformanceElectronApi }).electronAPI;
  return electronApi?.performance;
}

/** Per-skill aggregation for one horizon; [] when the channel is unwired or fails. */
export async function loadSkillPerformance(horizon: PerformanceHorizon): Promise<SkillPerformance[]> {
  try {
    const performance = api();
    if (typeof performance?.skill !== 'function') return [];
    return unwrapIpcResult<SkillPerformance[]>(await performance.skill({ horizon })) ?? [];
  } catch {
    return [];
  }
}

/** Per-strategy aggregation for one horizon; [] when the channel is unwired or fails. */
export async function loadStrategyPerformance(horizon: PerformanceHorizon): Promise<StrategyPerformance[]> {
  try {
    const performance = api();
    if (typeof performance?.strategy !== 'function') return [];
    return unwrapIpcResult<StrategyPerformance[]>(await performance.strategy({ horizon })) ?? [];
  } catch {
    return [];
  }
}

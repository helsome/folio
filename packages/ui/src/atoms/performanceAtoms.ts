import { atom } from 'jotai';
import type { PerformanceHorizon, SkillPerformance, StrategyPerformance } from '@finagent/core';
import { loadSkillPerformance, loadStrategyPerformance } from '../client/performance';

/**
 * Performance view state (spec §36–38).
 *
 * Aggregation runs in the main process (PerformanceService over the outcome
 * repository) and is exposed over IPC. Both cards share one atom so a horizon
 * switch refreshes skill + strategy aggregations together; loaders degrade to
 * empty arrays while the channel is unwired.
 */

export interface PerformanceState {
  loading: boolean;
  skills: SkillPerformance[];
  strategies: StrategyPerformance[];
}

export const performanceAtom = atom<PerformanceState>({
  loading: false,
  skills: [],
  strategies: [],
});

/** Active horizon tab (1w / 1m / 3m). */
export const performanceHorizonAtom = atom<PerformanceHorizon>('1m');

/** Refresh both aggregations for a horizon; results land in `performanceAtom`. */
export const refreshPerformanceAtom = atom(null, async (_get, set, horizon: PerformanceHorizon) => {
  set(performanceAtom, (state) => ({ ...state, loading: true }));
  const [skills, strategies] = await Promise.all([
    loadSkillPerformance(horizon),
    loadStrategyPerformance(horizon),
  ]);
  set(performanceAtom, { loading: false, skills, strategies });
});

export type { PerformanceHorizon, SkillPerformance, StrategyPerformance } from '@finagent/core';

import { atom } from 'jotai';
import type {
  PerformanceHorizon,
  SkillCalibration,
  SkillPerformance,
  StrategyCalibration,
  StrategyPerformance,
} from '@finagent/core';
import {
  loadSkillCalibration,
  loadSkillPerformance,
  loadStrategyCalibration,
  loadStrategyPerformance,
} from '../client/performance';

/**
 * Performance view state (spec §36–42).
 *
 * Aggregation runs in the main process (PerformanceService over the outcome
 * repository) and is exposed over IPC. The four collections share one atom
 * so a horizon switch refreshes skill + strategy aggregations and their
 * calibrations together; loaders degrade to empty arrays while a channel is
 * unwired.
 */

export interface PerformanceState {
  loading: boolean;
  skills: SkillPerformance[];
  strategies: StrategyPerformance[];
  calibrations: SkillCalibration[];
  strategyCalibrations: StrategyCalibration[];
}

export const performanceAtom = atom<PerformanceState>({
  loading: false,
  skills: [],
  strategies: [],
  calibrations: [],
  strategyCalibrations: [],
});

/** Active horizon tab (1w / 1m / 3m). */
export const performanceHorizonAtom = atom<PerformanceHorizon>('1m');

/** Refresh all four aggregations for a horizon; results land in `performanceAtom`. */
export const refreshPerformanceAtom = atom(
  null,
  async (_get, set, horizon: PerformanceHorizon) => {
    set(performanceAtom, (state) => ({ ...state, loading: true }));
    const [skills, strategies, calibrations, strategyCalibrations] = await Promise.all([
      loadSkillPerformance(horizon),
      loadStrategyPerformance(horizon),
      loadSkillCalibration(horizon),
      loadStrategyCalibration(horizon),
    ]);
    set(performanceAtom, {
      loading: false,
      skills,
      strategies,
      calibrations,
      strategyCalibrations,
    });
  }
);

export type {
  PerformanceHorizon,
  SkillCalibration,
  SkillPerformance,
  StrategyCalibration,
  StrategyPerformance,
} from '@finagent/core';

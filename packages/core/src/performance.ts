/**
 * V5 Skill / Strategy Performance domain (spec §36–38).
 *
 * Aggregated from ResearchOutcome records. Below MIN_EVALUATED_SAMPLES the
 * views are Observational Only — never tuned on a handful of samples.
 */

export type PerformanceHorizon = '1w' | '1m' | '3m';

export interface SkillPerformance {
  skillId: string;
  horizon: PerformanceHorizon;
  samples: number;
  /** Directional hit rate 0..1 (bull→up, bear→down, neutral→bounded). */
  directionHitRate?: number;
  /** Mean signed return percent. */
  avgReturn?: number;
  /** Fraction of outcomes that were `unable`. */
  unableRate?: number;
  insufficientData: boolean;
}

export interface StrategyPerformance {
  strategyId: string;
  horizon: PerformanceHorizon;
  samples: number;
  hitRate?: number;
  /** Median excess return vs benchmark, percent. */
  medianExcessReturn?: number;
  insufficientData: boolean;
}

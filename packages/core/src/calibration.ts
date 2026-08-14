/**
 * V5 Adaptive Calibration domain (spec §39–42, stretch).
 *
 * Calibration converts a skill's (or strategy's) historical track record
 * into a bounded weight. INFORMATIONAL ONLY in this version: the weights are
 * computed and displayed for transparency (spec §42) but the research
 * planner does NOT read them yet — runtime weighting stays future work. No
 * skill file is mutated and no strategy is rewritten; this module only
 * describes how a weight would be derived from measured outcomes.
 */
import { MIN_EVALUATED_SAMPLES } from './outcome.ts'

/** Weight clamp range — calibration is NEVER unbounded (spec §41). */
export interface WeightBounds {
  min: number
  max: number
}

export const WEIGHT_BOUNDS: WeightBounds = { min: 0.75, max: 1.25 }

/** Neutral starting weight — every skill/strategy begins at parity. */
export const BASE_WEIGHT = 1

/** Samples needed before a calibration stops being Observational Only. */
export const MIN_CALIBRATION_SAMPLES = MIN_EVALUATED_SAMPLES

/** Version of the calibration rules that produced the weights (spec §41). */
export const CALIBRATION_VERSION = '1.0.0'

export interface SkillCalibration {
  skillId: string
  /** Neutral starting weight (BASE_WEIGHT). */
  baseWeight: number
  /** Directional hit rate 0..1 among evaluated samples; null below min samples. */
  historicalReliability: number | null
  /** min(1, samples / 100) — 100 samples = full confidence; null below min samples. */
  sampleConfidence: number | null
  /** unableRate × 0.05, capped at 0.05; null below min samples. */
  unablePenalty: number | null
  /** Clamped weight in [WEIGHT_BOUNDS.min, WEIGHT_BOUNDS.max]; null below min samples. */
  finalBoundedWeight: number | null
  samples: number
  insufficientData: boolean
}

export interface StrategyCalibration {
  strategyId: string
  baseWeight: number
  /** Directional hit rate 0..1 among evaluated samples; null below min samples. */
  historicalReliability: number | null
  /** min(1, samples / 100) — 100 samples = full confidence; null below min samples. */
  sampleConfidence: number | null
  /** unableRate × 0.05, capped at 0.05; null below min samples. */
  unablePenalty: number | null
  /** Clamped weight in [WEIGHT_BOUNDS.min, WEIGHT_BOUNDS.max]; null below min samples. */
  finalBoundedWeight: number | null
  samples: number
  insufficientData: boolean
}

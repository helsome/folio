import {
  BASE_WEIGHT,
  MIN_CALIBRATION_SAMPLES,
  WEIGHT_BOUNDS,
  type PerformanceHorizon,
  type ResearchOpinion,
  type ResearchOutcome,
  type SkillCalibration,
  type StrategyCalibration,
  type WeightBounds,
} from '@finagent/core'

/**
 * V5 Adaptive Calibration computation (spec §39–42, stretch).
 *
 * PURE, deterministic transforms of evaluated ResearchOutcome records into
 * bounded weights — read-only like the performance aggregator. Nothing here
 * mutates skill files, rewrites strategies, or touches research planning.
 * The weights are INFORMATIONAL: the research planner does not read them in
 * this version (runtime weighting stays future work, spec §42).
 *
 * Formula (skills and strategies alike):
 *   reliability        = directionHitRate among evaluated samples (0..1)
 *   sampleConfidence   = min(1, samples / SAMPLE_CONFIDENCE_FULL_SAMPLES)
 *   unablePenalty      = unableRate × UNABLE_PENALTY_MAX_RATE (capped)
 *   raw                = BASE_WEIGHT + (reliability − 0.5) × RELIABILITY_SENSITIVITY − unablePenalty
 *   finalBoundedWeight = clamp(raw, bounds.min, bounds.max)  // NEVER unbounded (spec §41)
 *
 * Below MIN_CALIBRATION_SAMPLES (30) a group is Observational Only: the
 * derived numbers stay null and only `samples` + `insufficientData` are set.
 */

/** 100 evaluated samples = full confidence (documented constant, spec §41). */
export const SAMPLE_CONFIDENCE_FULL_SAMPLES = 100

/** The unable share can shave at most 5% off a weight (documented constant). */
export const UNABLE_PENALTY_MAX_RATE = 0.05

/** Weight sensitivity to reliability above/below the 0.5 midpoint. */
export const RELIABILITY_SENSITIVITY = 0.5

/** An outcome joined with the opinion that produced it. */
interface Pair {
  opinion: ResearchOpinion
  outcome: ResearchOutcome
}

interface GroupStats {
  total: number
  evaluated: number
  correct: number
  unable: number
}

/** Join outcomes to their opinions; drop orphans and off-horizon pairs. */
function pairByOpinion(
  opinions: ResearchOpinion[],
  outcomes: ResearchOutcome[],
  horizon: PerformanceHorizon
): Pair[] {
  const byId = new Map(opinions.map((opinion) => [opinion.id, opinion]))
  const pairs: Pair[] = []
  for (const outcome of outcomes) {
    const opinion = byId.get(outcome.opinionId)
    if (opinion === undefined || opinion.horizon !== horizon) continue
    pairs.push({ opinion, outcome })
  }
  return pairs
}

function accumulate(stats: Map<string, GroupStats>, key: string, pair: Pair): void {
  let group = stats.get(key)
  if (group === undefined) {
    group = { total: 0, evaluated: 0, correct: 0, unable: 0 }
    stats.set(key, group)
  }
  group.total += 1
  if (pair.outcome.status === 'unable') {
    group.unable += 1
    return
  }
  group.evaluated += 1
  if (pair.outcome.directionCorrect === true) group.correct += 1
}

function clamp(value: number, bounds: WeightBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

/**
 * The derived calibration numbers for one group; every derived field is null
 * below MIN_CALIBRATION_SAMPLES (Observational Only, spec §38 semantics).
 */
function numbersFor(group: GroupStats, bounds: WeightBounds): Pick<
  SkillCalibration,
  | 'historicalReliability'
  | 'sampleConfidence'
  | 'unablePenalty'
  | 'finalBoundedWeight'
  | 'samples'
  | 'insufficientData'
> {
  const samples = group.evaluated
  if (samples < MIN_CALIBRATION_SAMPLES) {
    return {
      historicalReliability: null,
      sampleConfidence: null,
      unablePenalty: null,
      finalBoundedWeight: null,
      samples,
      insufficientData: true,
    }
  }
  const reliability = group.correct / samples
  const sampleConfidence = Math.min(1, samples / SAMPLE_CONFIDENCE_FULL_SAMPLES)
  const unableRate = group.total > 0 ? group.unable / group.total : 0
  const unablePenalty = Math.min(UNABLE_PENALTY_MAX_RATE, unableRate * UNABLE_PENALTY_MAX_RATE)
  const raw = BASE_WEIGHT + (reliability - 0.5) * RELIABILITY_SENSITIVITY - unablePenalty
  const finalBoundedWeight = clamp(raw, bounds)
  return {
    historicalReliability: reliability,
    sampleConfidence,
    unablePenalty,
    finalBoundedWeight,
    samples,
    insufficientData: false,
  }
}

/**
 * Per-skill calibration for one horizon. A multi-skill opinion contributes
 * its outcome to each of its skill groups (deduplicated per opinion).
 * Deterministic: identical inputs always yield identical outputs, sorted by
 * samples descending then id ascending.
 */
export function computeSkillCalibrations(
  opinions: ResearchOpinion[],
  outcomes: ResearchOutcome[],
  horizon: PerformanceHorizon,
  bounds: WeightBounds = WEIGHT_BOUNDS
): SkillCalibration[] {
  const stats = new Map<string, GroupStats>()
  for (const pair of pairByOpinion(opinions, outcomes, horizon)) {
    const skillIds = new Set(pair.opinion.skillIds)
    for (const skillId of skillIds) {
      accumulate(stats, skillId, pair)
    }
  }
  const result: SkillCalibration[] = []
  for (const [skillId, group] of stats) {
    result.push({
      skillId,
      baseWeight: BASE_WEIGHT,
      ...numbersFor(group, bounds),
    })
  }
  return result.sort((a, b) => b.samples - a.samples || a.skillId.localeCompare(b.skillId))
}

/**
 * Per-strategy calibration for one horizon — the exact mirror of the skill
 * computation. Opinions without a strategy attribution are skipped — there
 * is no group to attribute them to.
 */
export function computeStrategyCalibrations(
  opinions: ResearchOpinion[],
  outcomes: ResearchOutcome[],
  horizon: PerformanceHorizon,
  bounds: WeightBounds = WEIGHT_BOUNDS
): StrategyCalibration[] {
  const stats = new Map<string, GroupStats>()
  for (const pair of pairByOpinion(opinions, outcomes, horizon)) {
    if (pair.opinion.strategyId === undefined) continue
    accumulate(stats, pair.opinion.strategyId, pair)
  }
  const result: StrategyCalibration[] = []
  for (const [strategyId, group] of stats) {
    result.push({
      strategyId,
      baseWeight: BASE_WEIGHT,
      ...numbersFor(group, bounds),
    })
  }
  return result.sort((a, b) => b.samples - a.samples || a.strategyId.localeCompare(b.strategyId))
}

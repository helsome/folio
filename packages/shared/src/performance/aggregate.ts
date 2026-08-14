import {
  MIN_EVALUATED_SAMPLES,
  type PerformanceHorizon,
  type ResearchOpinion,
  type ResearchOutcome,
  type SkillPerformance,
  type StrategyPerformance,
} from '@finagent/core'

/**
 * V5 Performance aggregation (spec §36–38).
 *
 * Pure statistics over evaluated ResearchOutcome records, grouped by the
 * skill ids / strategy id of the originating opinion. This module is strictly
 * read-only: outcomes are produced by the OutcomeEngine and never written
 * here.
 *
 * Semantics:
 * - Only opinions whose committed horizon matches the requested horizon
 *   contribute — mixed-horizon histories never leak into a tab.
 * - `samples` counts evaluated outcomes. `unable` outcomes count toward the
 *   unable rate but never toward the directional hit rate or average return.
 * - Below MIN_EVALUATED_SAMPLES (30) a group is Observational Only
 *   (`insufficientData: true`), matching spec §38 — never tuned on a
 *   handful of samples.
 * - Zero-sample groups are impossible to emit (groups form only from
 *   outcomes), but zero-evaluated groups are: rates stay `undefined` (no
 *   NaN), samples 0, `insufficientData` true.
 */

export interface AggregatePerformanceOptions {
  /** Groups below this evaluated-sample count are `insufficientData`. */
  minSamples?: number
}

/** An outcome joined with the opinion that produced it. */
interface Pair {
  opinion: ResearchOpinion
  outcome: ResearchOutcome
}

interface GroupStats {
  total: number
  evaluated: number
  correct: number
  returns: number[]
  excessReturns: number[]
  unable: number
}

function emptyStats(): GroupStats {
  return { total: 0, evaluated: 0, correct: 0, returns: [], excessReturns: [], unable: 0 }
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
    group = emptyStats()
    stats.set(key, group)
  }
  const { outcome } = pair
  group.total += 1
  if (outcome.status === 'unable') {
    group.unable += 1
    return
  }
  group.evaluated += 1
  if (outcome.directionCorrect === true) group.correct += 1
  if (typeof outcome.returnPercent === 'number' && Number.isFinite(outcome.returnPercent)) {
    group.returns.push(outcome.returnPercent)
  }
  if (
    typeof outcome.returnPercent === 'number' &&
    Number.isFinite(outcome.returnPercent) &&
    typeof outcome.benchmarkReturn === 'number' &&
    Number.isFinite(outcome.benchmarkReturn)
  ) {
    group.excessReturns.push(outcome.returnPercent - outcome.benchmarkReturn)
  }
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Per-skill performance for one horizon. A multi-skill opinion contributes
 * its outcome to each of its skill groups (deduplicated per opinion).
 */
export function aggregateSkillPerformance(
  opinions: ResearchOpinion[],
  outcomes: ResearchOutcome[],
  horizon: PerformanceHorizon,
  minSamples: number = MIN_EVALUATED_SAMPLES
): SkillPerformance[] {
  const stats = new Map<string, GroupStats>()
  for (const pair of pairByOpinion(opinions, outcomes, horizon)) {
    const skillIds = new Set(pair.opinion.skillIds)
    for (const skillId of skillIds) {
      accumulate(stats, skillId, pair)
    }
  }
  const result: SkillPerformance[] = []
  for (const [skillId, group] of stats) {
    result.push({
      skillId,
      horizon,
      samples: group.evaluated,
      directionHitRate: group.evaluated > 0 ? group.correct / group.evaluated : undefined,
      avgReturn: mean(group.returns),
      unableRate: group.total > 0 ? group.unable / group.total : undefined,
      insufficientData: group.evaluated < minSamples,
    })
  }
  return result.sort((a, b) => b.samples - a.samples || a.skillId.localeCompare(b.skillId))
}

/**
 * Per-strategy performance for one horizon. Opinions without a strategy
 * attribution are skipped — there is no group to attribute them to.
 */
export function aggregateStrategyPerformance(
  opinions: ResearchOpinion[],
  outcomes: ResearchOutcome[],
  horizon: PerformanceHorizon,
  minSamples: number = MIN_EVALUATED_SAMPLES
): StrategyPerformance[] {
  const stats = new Map<string, GroupStats>()
  for (const pair of pairByOpinion(opinions, outcomes, horizon)) {
    if (pair.opinion.strategyId === undefined) continue
    accumulate(stats, pair.opinion.strategyId, pair)
  }
  const result: StrategyPerformance[] = []
  for (const [strategyId, group] of stats) {
    result.push({
      strategyId,
      horizon,
      samples: group.evaluated,
      hitRate: group.evaluated > 0 ? group.correct / group.evaluated : undefined,
      medianExcessReturn: median(group.excessReturns),
      insufficientData: group.evaluated < minSamples,
    })
  }
  return result.sort((a, b) => b.samples - a.samples || a.strategyId.localeCompare(b.strategyId))
}

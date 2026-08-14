import type {
  Kline,
  OpinionHorizon,
  OpinionStance,
  OutcomeExpectation,
  ResearchOpinion,
  ResearchOutcome,
  OutcomeStatus,
} from '@finagent/core'
import { OUTCOME_ENGINE_VERSION } from '@finagent/core'

/**
 * Outcome Engine (spec §32–35). Turns a snapshotted ResearchOpinion plus the
 * price history observed after creation into a ResearchOutcome.
 *
 * Time units: opinion timestamps are epoch ms (`createdAt`); Kline bars from
 * the capability layer carry epoch **seconds** timestamps — `barMs` normalizes
 * before any comparison. Bars are assumed ascending; the engine sorts
 * defensively.
 *
 * Versioning (spec §34): the engine stamps `outcomeEngineVersion` on every
 * outcome. Direction expectations (per-stance) are versioned with the engine
 * so a future rule change never rewrites history.
 */

/** Committed horizon lengths (spec §31): 1w = 7d, 1m = 30d, 3m = 90d. */
export const HORIZON_MS: Record<OpinionHorizon, number> = {
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '3m': 90 * 24 * 60 * 60 * 1000,
}

/** Neutral opinions count as correct when the move stays within ±2.0%. */
export const NEUTRAL_BOUND_PCT = 2.0

export type OutcomeUnableReason = 'no-price-data' | 'delisted' | 'entry-unknown'

export interface EvaluateOptions {
  /** Evaluation timestamp (ms). Defaults to Date.now(). */
  now?: number
  /**
   * Signed benchmark return over the same window, when the provider can
   * supply index data. Never fabricated — omit when unavailable (spec §35).
   */
  benchmarkReturn?: number
  /** Overrides OUTCOME_ENGINE_VERSION (tests / future engine generations). */
  version?: string
}

/** Absolute horizon end of an opinion (ms). */
export function horizonEndMs(opinion: Pick<ResearchOpinion, 'createdAt' | 'horizon'>): number {
  return opinion.createdAt + HORIZON_MS[opinion.horizon]
}

/**
 * Per-stance expectation model (spec §34). Neutral opinions are bounded by
 * default: correct ⇔ the move stayed within ±NEUTRAL_BOUND_PCT.
 */
export function expectationFor(stance: OpinionStance): OutcomeExpectation {
  switch (stance) {
    case 'bullish':
      return { kind: 'bullish', positiveReturn: true }
    case 'bearish':
      return { kind: 'bearish', negativeReturn: true }
    case 'neutral':
      return { kind: 'neutral', bounded: true }
  }
}

/**
 * Whether the observed signed return matched the opinion's directional
 * expectation. `undefined` when the expectation makes no directional claim
 * (an unbounded neutral opinion).
 */
export function directionCorrectFor(
  stance: OpinionStance,
  returnPercent: number,
  expectation: OutcomeExpectation = expectationFor(stance)
): boolean | undefined {
  switch (expectation.kind) {
    case 'bullish':
      return expectation.positiveReturn ? returnPercent > 0 : returnPercent < 0
    case 'bearish':
      return expectation.negativeReturn ? returnPercent < 0 : returnPercent > 0
    case 'neutral':
      return expectation.bounded ? Math.abs(returnPercent) <= NEUTRAL_BOUND_PCT : undefined
  }
}

/**
 * Peak-to-trough decline over a close series, as a positive percent in
 * 0..100 (0 = never below the running peak).
 */
export function maxDrawdownPct(closes: number[]): number {
  let peak = -Infinity
  let maxDrawdown = 0
  for (const close of closes) {
    if (close > peak) peak = close
    if (peak > 0) {
      const drawdown = ((peak - close) / peak) * 100
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }
  }
  return maxDrawdown
}

const barMs = (bar: Kline): number => bar.timestamp * 1000

function unable(
  opinion: ResearchOpinion,
  reason: OutcomeUnableReason,
  entryPrice: number | undefined,
  evaluatedAt: number,
  version: string
): ResearchOutcome {
  return {
    id: `outcome-${opinion.id}`,
    opinionId: opinion.id,
    horizon: opinion.horizon,
    evaluatedAt,
    entryPrice,
    status: 'unable' as OutcomeStatus,
    reason,
    outcomeEngineVersion: version,
  }
}

/**
 * Evaluates one opinion against post-creation price history.
 *
 * Entry resolution (documented): `opinion.entryPrice` when snapshotted at
 * creation; otherwise the FIRST history close anchors the entry — never a
 * backfilled quote. Exit is the close of the last bar at-or-before the
 * horizon end; when the series is shorter than the horizon, the last
 * available close stands in (an honest measurement of the observable window).
 * When no bar reaches the horizon end at all, the series does not overlap the
 * committed window and the outcome is `unable`/`delisted`.
 */
export class OutcomeEngine {
  evaluate(
    opinion: ResearchOpinion,
    history: Kline[] | null,
    options: EvaluateOptions = {}
  ): ResearchOutcome {
    const evaluatedAt = options.now ?? Date.now()
    const version = options.version ?? OUTCOME_ENGINE_VERSION

    // No market data at all: nothing to measure.
    if (!history || history.length === 0) {
      return unable(
        opinion,
        opinion.entryPrice === undefined ? 'entry-unknown' : 'no-price-data',
        opinion.entryPrice,
        evaluatedAt,
        version
      )
    }

    const bars = [...history].sort((a, b) => barMs(a) - barMs(b))

    // Entry: opinion snapshot first, else the first available close.
    const entry = opinion.entryPrice ?? bars[0].close
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      return unable(opinion, 'entry-unknown', entry, evaluatedAt, version)
    }

    const end = horizonEndMs(opinion)

    // Exit: last bar at-or-before the horizon end. If no bar reaches the
    // horizon end, the data does not overlap the committed window — there is
    // no honest exit price (spec §31 never fabricates).
    let exitIndex = -1
    for (let i = 0; i < bars.length; i += 1) {
      if (barMs(bars[i]) <= end) exitIndex = i
    }
    if (exitIndex === -1) {
      return unable(opinion, 'delisted', entry, evaluatedAt, version)
    }

    const exit = bars[exitIndex].close
    const windowCloses = bars.slice(0, exitIndex + 1).map((bar) => bar.close)
    const returnPercent = ((exit - entry) / entry) * 100

    const outcome: ResearchOutcome = {
      id: `outcome-${opinion.id}`,
      opinionId: opinion.id,
      horizon: opinion.horizon,
      evaluatedAt,
      entryPrice: entry,
      exitPrice: exit,
      returnPercent,
      directionCorrect: directionCorrectFor(opinion.stance, returnPercent),
      maximumDrawdown: maxDrawdownPct(windowCloses),
      status: 'evaluated',
      outcomeEngineVersion: version,
    }
    if (options.benchmarkReturn !== undefined) {
      outcome.benchmarkReturn = options.benchmarkReturn
    }
    return outcome
  }
}

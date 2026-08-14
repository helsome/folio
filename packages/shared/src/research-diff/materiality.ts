import type { ResearchChange } from '@finagent/core'

/**
 * Deterministic materiality rules for research diffs (spec §25).
 *
 * A change is material when any single rule fires:
 *   - absolute price move ≥ MATERIAL_PRICE_MOVE_PCT
 *   - section verdict flip (positive ↔ negative)
 *   - analyst rating label changed
 *   - report confidence delta ≥ MATERIAL_CONFIDENCE_DELTA
 *   - new risk (category `risk`, direction `new`) — e.g. a risk added to the
 *     risks list or a new risk section
 *   - new earnings (category `earnings`, direction `new`) — a fresh earnings
 *     section appeared
 *
 * The diff builder stamps every `ResearchChange` with `material` by calling
 * `isMaterial`; the rules are encoded in the change's own fields (label,
 * before/after, category, direction) so they stay testable in isolation.
 */

/** Absolute price move (percent) at or above which a price change is material. */
export const MATERIAL_PRICE_MOVE_PCT = 5

/** Report confidence delta (0..1) at or above which a confidence change is material. */
export const MATERIAL_CONFIDENCE_DELTA = 0.25

/** Change label for a section verdict transition. */
export const VERDICT_CHANGE_LABEL = 'Verdict'
/** Change label for an extracted price move. */
export const PRICE_LABEL = 'Price'
/** Change label for an analyst rating transition. */
export const RATING_LABEL = 'Rating'
/** Change label for a report-level confidence delta. */
export const CONFIDENCE_LABEL = 'Confidence'

/** True when the before/after verdicts flip across the bullish/bearish line. */
export function isVerdictFlip(before: unknown, after: unknown): boolean {
  return (
    (before === 'positive' && after === 'negative') ||
    (before === 'negative' && after === 'positive')
  )
}

/**
 * Whether a change crosses the materiality bar. Pure and deterministic — the
 * diff builder and automation can both rely on it without re-deriving rules.
 */
export function isMaterial(change: ResearchChange): boolean {
  if (change.label === VERDICT_CHANGE_LABEL) {
    return isVerdictFlip(change.before, change.after)
  }
  if (change.label === RATING_LABEL) {
    return change.before !== undefined && change.after !== undefined && change.before !== change.after
  }
  if (change.label === PRICE_LABEL) {
    const before = asFiniteNumber(change.before)
    const after = asFiniteNumber(change.after)
    if (before === null || after === null || before === 0) return false
    return (Math.abs(after - before) / Math.abs(before)) * 100 >= MATERIAL_PRICE_MOVE_PCT
  }
  if (change.label === CONFIDENCE_LABEL) {
    const before = asFiniteNumber(change.before)
    const after = asFiniteNumber(change.after)
    if (before === null || after === null) return false
    return Math.abs(after - before) >= MATERIAL_CONFIDENCE_DELTA
  }
  if (change.direction === 'new') {
    return change.category === 'risk' || change.category === 'earnings'
  }
  return false
}

function asFiniteNumber(value: string | number | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(value?.trim() ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

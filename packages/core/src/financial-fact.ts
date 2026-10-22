/**
 * Financial Fact Envelope — the single semantic wrapper every key financial
 * number should carry before it enters an Agent, a report, or the UI.
 *
 * The most dangerous finance-copilot error is not "no data", it is treating
 * numbers with *different* time, currency, unit, or adjustment semantics as the
 * same fact: a real-time price vs. a 15-minute-delayed price, a previous-close
 * vs. a fiscal-period-end value, USD vs. HKD, raw OHLC vs. split-adjusted OHLC.
 * When these travel as bare `number`/`string`, downstream layers cannot tell
 * them apart.
 *
 * This module defines:
 *   - `FinancialFact` — the envelope (instrument, metric, value, structured
 *     unit, native currency, `asOf` vs. `retrievedAt`, timing, adjustment,
 *     fiscal period, FX-conversion provenance, staleness, and explicit unknowns).
 *   - helpers to describe, convert, and classify facts so both the Agent (via a
 *     capability `summary`) and the UI (via `stale`/`timing`) can answer
 *     "what time, what currency, what basis is this number".
 *
 * Rules (issue #24):
 *   - `asOf` is the DATA's own timestamp — never `Date.now()`.
 *   - `retrievedAt` is when WE fetched it — kept separate from `asOf`.
 *   - currency / unit are structured (ISO code + `FactUnit`), never parsed from
 *     free text.
 *   - a currency conversion preserves the native value/currency and adds
 *     `FxConversion` provenance.
 *   - price series carry an explicit `adjustment`; raw vs. adjusted are never
 *     silently mixed.
 *   - anything the provider did not tell us is recorded in `unknown`, never
 *     guessed.
 *
 * Timestamps are epoch SECONDS unless noted otherwise, matching the existing
 * core convention (`Quote.timestamp`, `Kline.timestamp`).
 */

// ── Timing (data status) ────────────────────────────────────────────────────

/**
 * The temporal status of a fact's value.
 *
 * - `live`        — real-time value (or as close to it as the provider gives).
 * - `delayed`     — snapshot lagging real-time by a known/unknown delay.
 * - `eod`         — end-of-day value (final daily bar / close).
 * - `historical`  — a completed, point-in-time observation (an old bar, a past
 *                   fiscal-period metric).
 * - `unknown`     — the provider did not tell us; callers MUST NOT guess.
 */
export type FactTiming = 'live' | 'delayed' | 'eod' | 'historical' | 'unknown';

// ── Adjustment (price series only) ──────────────────────────────────────────

/**
 * How a price series was adjusted for corporate actions. `undefined` means the
 * value is NOT a price series (e.g. a fundamental metric), so adjustment does
 * not apply. Price series always set this explicitly — `raw` is never implied
 * — and use `unknown` when the provider did not say (never guessed).
 */
export type FactAdjustment =
  | 'raw'
  | 'split-adjusted'
  | 'dividend-adjusted'
  | 'split-and-dividend-adjusted'
  | 'unknown';

// ── Structured unit ─────────────────────────────────────────────────────────

/**
 * A structured unit — never free text. `currency` is tracked separately on the
 * fact; this records the *shape* of the number so percentages, basis points,
 * ratios and scaled amounts are never guessed from a string.
 */
export type FactUnit =
  | { kind: 'currency' }
  | { kind: 'percent' }
  | { kind: 'basis-points' }
  | { kind: 'ratio' }
  | { kind: 'shares' }
  | { kind: 'count' }
  | { kind: 'scaled'; magnitude: 'thousand' | 'million' | 'billion' }
  | { kind: 'unknown' };

// ── Fiscal period ───────────────────────────────────────────────────────────

export type FiscalPeriodKind = 'fy' | 'ttm' | 'quarter' | 'semi-annual' | 'annual' | 'unknown';

/** Fiscal-period semantics for fundamental facts (income/balance/cash-flow). */
export interface FiscalPeriod {
  kind: FiscalPeriodKind;
  /** Fiscal year, when known. */
  year?: number;
  /** Calendar quarter, when `kind === 'quarter'`. */
  quarter?: 1 | 2 | 3 | 4;
  /** Epoch seconds of the fiscal-period end — the metric's own "as of". */
  end?: number;
  /** Provider display label, e.g. `Q1 2027`. */
  label?: string;
}

// ── FX conversion provenance ────────────────────────────────────────────────

/** Metadata for a currency conversion applied to a fact's value. */
export interface FxConversion {
  /** Native (pre-conversion) currency. */
  fromCurrency: string;
  /** Display (post-conversion) currency. */
  toCurrency: string;
  rate: number;
  /** Epoch seconds of the FX rate. */
  rateAsOf: number;
  source?: string;
}

// ── The envelope ────────────────────────────────────────────────────────────

export interface FinancialFact {
  /** Canonical instrument id, `CODE.MARKET` (empty for market-level facts). */
  instrumentId: string;
  /** Stable metric identity, e.g. `lastPrice`, `close`, `TotalAssets`. */
  metric: string;
  /** The numeric value, already expressed in `unit` / `currency`. */
  value: number;
  /** Structured unit — never free text. */
  unit: FactUnit;
  /** Native ISO currency code (undefined for non-monetary facts). */
  currency?: string;
  /** The DATA's own timestamp (epoch seconds). Never `Date.now()`. */
  asOf?: number;
  /** Fiscal-period semantics, for fundamental facts. */
  period?: FiscalPeriod;
  /** Epoch seconds when WE fetched the data. */
  retrievedAt: number;
  provider?: string;
  timing: FactTiming;
  /** Present only for price series; `raw` is explicit, never implied. */
  adjustment?: FactAdjustment;
  /** IANA exchange timezone, e.g. `America/New_York`. */
  exchangeTimezone?: string;
  /** Market session, e.g. `regular`, `pre`, `post`, `closed`. */
  marketSession?: string;
  /**
   * Native (pre-conversion) value/currency, preserved when a currency
   * conversion was applied. Absent when no conversion happened.
   */
  native?: { value: number; currency: string };
  /** Conversion provenance, present only when a conversion happened. */
  fxConversion?: FxConversion;
  /** Freshness classification relative to `asOf` + `timing`. */
  stale: boolean;
  /** Fields the provider did not tell us — explicit, never guessed. */
  unknown?: string[];
}

// ── Staleness ───────────────────────────────────────────────────────────────

export interface StalenessOptions {
  /** Epoch seconds to measure against. Defaults to `Date.now() / 1000`. */
  now?: number;
  /** Max age (sec) for `live` data before it is stale. Default 5 min. */
  liveMaxAgeSec?: number;
  /** Max age (sec) for `delayed` data before it is stale. Default 15 min. */
  delayedMaxAgeSec?: number;
  /** Max age (sec) for `unknown`-timing data before it is stale. Default 1 day. */
  unknownMaxAgeSec?: number;
}

/**
 * Classify staleness from a fact's timing and `asOf`.
 *
 * `eod` and `historical` values are point-in-time observations — they never
 * become stale (a historical close does not "expire"). `live` / `delayed` /
 * `unknown` values become stale once they are older than their timing's max age.
 * A missing `asOf` cannot be classified, so it is NOT stale (the caller should
 * also mark `asOf` in `unknown`).
 */
export function computeStale(
  timing: FactTiming,
  asOf: number | undefined,
  options: StalenessOptions = {}
): boolean {
  if (asOf === undefined) return false;
  if (timing === 'eod' || timing === 'historical') return false;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const age = now - asOf;
  if (age < 0) return false; // clock skew — never flag future data as stale

  switch (timing) {
    case 'live':
      return age > (options.liveMaxAgeSec ?? 300);
    case 'delayed':
      return age > (options.delayedMaxAgeSec ?? 900);
    default:
      return age > (options.unknownMaxAgeSec ?? 86_400);
  }
}

// ── Unknown marking ─────────────────────────────────────────────────────────

/** Return a copy of `fact` with extra fields recorded as explicitly unknown. */
export function markUnknown(fact: FinancialFact, ...fields: string[]): FinancialFact {
  if (fields.length === 0) return fact;
  const seen = new Set(fact.unknown ?? []);
  for (const field of fields) seen.add(field);
  return { ...fact, unknown: [...seen] };
}

// ── FX conversion ───────────────────────────────────────────────────────────

/**
 * Apply a currency conversion, preserving the native value/currency and the
 * conversion provenance. Conversion is refused (returned unchanged, with
 * `currency` marked unknown) when there is no native currency to convert from.
 */
export function convertCurrency(
  fact: FinancialFact,
  toCurrency: string,
  rate: number,
  rateAsOf: number,
  source?: string
): FinancialFact {
  const target = (toCurrency ?? '').trim().toUpperCase();
  if (fact.currency === undefined || fact.currency === '' || target === '') {
    return markUnknown(fact, 'currency');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return markUnknown(fact, 'fxConversion');
  }

  const native = fact.native ?? { value: fact.value, currency: fact.currency };
  return {
    ...fact,
    value: fact.value * rate,
    currency: target,
    native,
    fxConversion: {
      fromCurrency: fact.currency,
      toCurrency: target,
      rate,
      rateAsOf,
      source,
    },
  };
}

// ── Price series ────────────────────────────────────────────────────────────

/** True when the fact is a price-series value (carries an `adjustment`). */
export function isPriceSeries(fact: FinancialFact): boolean {
  return fact.adjustment !== undefined;
}

// ── Formatting / description ────────────────────────────────────────────────

/** Human label for a structured unit (empty for unitless ratios/counts). */
export function unitLabel(unit: FactUnit): string {
  switch (unit.kind) {
    case 'percent':
      return '%';
    case 'basis-points':
      return 'bp';
    case 'shares':
      return 'shares';
    case 'scaled':
      return { thousand: 'k', million: 'M', billion: 'B' }[unit.magnitude];
    default:
      return '';
  }
}

/** `epoch seconds` → `YYYY-MM-DD HH:mm:ss UTC` (deterministic). */
function formatEpoch(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return String(seconds);
  const iso = date.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function formatValue(fact: FinancialFact): string {
  const raw = fact.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const label = unitLabel(fact.unit);
  return label === '' ? raw : `${raw}${label}`;
}

function describePeriod(period: FiscalPeriod | undefined): string | undefined {
  if (!period) return undefined;
  if (period.label) return period.label;
  if (period.kind === 'quarter' && period.year !== undefined && period.quarter !== undefined) {
    return `Q${period.quarter} ${period.year}`;
  }
  if (period.year !== undefined) return `${period.kind.toUpperCase()} ${period.year}`;
  return period.kind;
}

/**
 * One-line, human/agent-readable description of a fact that answers
 * "what time, what currency, what basis is this number".
 *
 * Example:
 *   `NVDA.US lastPrice: 224.12 USD (live, raw, as of 2026-06-04 15:59:59 UTC, retrieved 2026-06-04 16:00:02 UTC)`
 */
export function describeFact(fact: FinancialFact): string {
  const head = `${fact.instrumentId} ${fact.metric}: ${formatValue(fact)}`;

  const qualifiers: string[] = [];
  if (fact.currency) qualifiers.push(fact.currency);
  else if (fact.unit.kind === 'currency') qualifiers.push('currency unknown');
  if (fact.timing !== 'unknown') qualifiers.push(fact.timing);
  if (fact.adjustment) qualifiers.push(fact.adjustment);
  const period = describePeriod(fact.period);
  if (period) qualifiers.push(period);
  if (fact.marketSession) qualifiers.push(fact.marketSession);
  if (fact.asOf !== undefined) qualifiers.push(`as of ${formatEpoch(fact.asOf)}`);
  qualifiers.push(`retrieved ${formatEpoch(fact.retrievedAt)}`);
  if (fact.fxConversion) {
    qualifiers.push(
      `converted ${fact.fxConversion.fromCurrency}→${fact.fxConversion.toCurrency} @ ${fact.fxConversion.rate}`
    );
  }
  if (fact.stale) qualifiers.push('stale');

  return `${head} (${qualifiers.join(', ')})`;
}

/** Describe a batch of facts, one per line (default 12). */
export function factsToSummary(facts: FinancialFact[], max = 12): string {
  return facts.slice(0, max).map(describeFact).join('\n');
}

/**
 * A short machine-readable freshness label for the UI, derived from the same
 * fields `DataFreshness` already renders. Returns `live`, `delayed`, `eod`,
 * `historical`, `stale`, or `unknown`.
 */
export function factFreshnessLabel(fact: FinancialFact): string {
  if (fact.timing !== 'unknown') return fact.timing;
  if (fact.stale) return 'stale';
  return 'unknown';
}

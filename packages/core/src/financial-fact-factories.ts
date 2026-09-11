/**
 * Factories that map the provider-neutral market-data shapes (`Quote`, `Kline`,
 * `FinancialReport`, `CalcIndex`) into the unified `FinancialFact` envelope.
 *
 * These are the ONE place that knows how each shape's timestamps, currencies,
 * units, and periods map onto fact semantics, so the capability layer and the
 * agent stay ignorant of those details. Every price-series fact is tagged with
 * an explicit `adjustment` (never left to be implied as raw), every fundamental
 * fact carries a structured `FiscalPeriod`, and anything the source did not
 * tell us is recorded in `unknown` rather than guessed.
 *
 * Timestamps are epoch SECONDS, matching `Quote.timestamp` / `Kline.timestamp`
 * / `FinancialReportValue.fpEnd`. `retrievedAt` is the fetch time — always kept
 * separate from `asOf` (the data's own timestamp), never derived from
 * `Date.now()` as a stand-in for the data.
 */

import type { CalcIndex, Kline, Quote } from './index.ts';
import type {
  FinancialReport,
  FinancialReportAccount,
  FinancialReportValue,
} from './market-data.ts';
import {
  computeStale,
  markUnknown,
  type FactAdjustment,
  type FactTiming,
  type FactUnit,
  type FinancialFact,
  type FiscalPeriod,
} from './financial-fact.ts';

/** Options shared by every factory; all optional, all non-guessing. */
export interface FactFactoryOptions {
  provider?: string;
  /** Epoch seconds the data was fetched. Defaults to now. */
  retrievedAt?: number;
  /** Temporal status (`live`/`delayed`/`eod`/`historical`). Defaults to `unknown`. */
  timing?: FactTiming;
  /** Native ISO currency. When omitted for a monetary fact, `currency` is unknown. */
  currency?: string;
  /** Price-series adjustment; `unknown` when the source did not say. */
  adjustment?: FactAdjustment;
  /** IANA exchange timezone, e.g. `America/New_York`. */
  exchangeTimezone?: string;
  /** Market session, e.g. `regular` / `pre` / `post` / `closed`. */
  marketSession?: string;
  /** Injectable clock (epoch ms) for `retrievedAt`/staleness. */
  now?: () => number;
}

/**
 * Deterministic market-code → native-currency lookup for `CODE.MARKET` symbols.
 * This is a structured code table (not free-text parsing) and returns
 * `undefined` for unknown markets so callers can mark the currency unknown
 * rather than guess.
 */
const MARKET_CURRENCY: Record<string, string> = {
  US: 'USD',
  HK: 'HKD',
  SH: 'CNY',
  SZ: 'CNY',
  SG: 'SGD',
};

export function marketCurrencyOf(symbol: string): string | undefined {
  const parts = (symbol ?? '').trim().toUpperCase().split('.');
  const market = parts[parts.length - 1] ?? '';
  return MARKET_CURRENCY[market];
}

// ── internal helpers ────────────────────────────────────────────────────────

function nowSeconds(now?: () => number): number {
  return Math.floor((now?.() ?? Date.now()) / 1000);
}

function resolveRetrievedAt(options: FactFactoryOptions): number {
  return options.retrievedAt ?? nowSeconds(options.now);
}

interface FactBase {
  instrumentId: string;
  currency?: string;
  asOf?: number;
  retrievedAt: number;
  provider?: string;
  timing: FactTiming;
  adjustment?: FactAdjustment;
  exchangeTimezone?: string;
  marketSession?: string;
  stale: boolean;
}

function makeBase(options: FactFactoryOptions): Omit<FactBase, 'instrumentId' | 'asOf' | 'stale'> {
  return {
    currency: options.currency,
    retrievedAt: resolveRetrievedAt(options),
    provider: options.provider,
    timing: options.timing ?? 'unknown',
    adjustment: options.adjustment,
    exchangeTimezone: options.exchangeTimezone,
    marketSession: options.marketSession,
  };
}

/** A monetary fact: structured `currency` unit, `currency` marked unknown when absent. */
function moneyFact(
  base: Omit<FactBase, 'instrumentId' | 'asOf' | 'stale'> & Pick<FactBase, 'instrumentId' | 'asOf' | 'stale'>,
  metric: string,
  value: number
): FinancialFact {
  const fact: FinancialFact = {
    ...base,
    metric,
    value,
    unit: { kind: 'currency' },
  };
  return base.currency ? fact : markUnknown(fact, 'currency');
}

/** A non-monetary fact with an explicit structured unit. */
function unitFact(
  base: Omit<FactBase, 'instrumentId' | 'asOf' | 'stale'> & Pick<FactBase, 'instrumentId' | 'asOf' | 'stale'>,
  metric: string,
  value: number,
  unit: FactUnit
): FinancialFact {
  return { ...base, metric, value, unit };
}

// ── Quote ───────────────────────────────────────────────────────────────────

/**
 * A real-time quote → facts for last/prev-close/open/high/low (spot, `raw`),
 * change (currency delta), change-percent, and volume. `asOf` is
 * `quote.timestamp`; `retrievedAt` is the fetch time.
 */
export function quoteToFacts(quote: Quote, options: FactFactoryOptions = {}): FinancialFact[] {
  const shared = makeBase(options);
  const base: FactBase = {
    ...shared,
    instrumentId: quote.symbol,
    asOf: quote.timestamp,
    adjustment: options.adjustment ?? 'raw',
    stale: computeStale(options.timing ?? 'unknown', quote.timestamp, {
      now: shared.retrievedAt,
    }),
  };

  const facts: FinancialFact[] = [
    moneyFact(base, 'lastPrice', quote.lastPrice),
    moneyFact(base, 'prevClose', quote.prevClose),
    moneyFact(base, 'open', quote.open),
    moneyFact(base, 'high', quote.high),
    moneyFact(base, 'low', quote.low),
    moneyFact(base, 'change', quote.change),
    unitFact({ ...base, adjustment: undefined }, 'changePercent', quote.changePercent, {
      kind: 'percent',
    }),
    unitFact({ ...base, adjustment: undefined }, 'volume', quote.volume, { kind: 'shares' }),
  ];
  return facts;
}

// ── Kline (historical bars) ─────────────────────────────────────────────────

/**
 * One historical bar → facts for OHLC (price series) and volume. The
 * `adjustment` is explicit; it defaults to `unknown` (never silently `raw`).
 */
export function klineToFacts(kline: Kline, options: FactFactoryOptions = {}): FinancialFact[] {
  const shared = makeBase(options);
  const base: FactBase = {
    ...shared,
    instrumentId: kline.symbol,
    asOf: kline.timestamp,
    adjustment: options.adjustment ?? 'unknown',
    stale: computeStale(options.timing ?? 'unknown', kline.timestamp, {
      now: shared.retrievedAt,
    }),
  };

  return [
    moneyFact(base, 'open', kline.open),
    moneyFact(base, 'high', kline.high),
    moneyFact(base, 'low', kline.low),
    moneyFact(base, 'close', kline.close),
    unitFact({ ...base, adjustment: undefined }, 'volume', kline.volume, { kind: 'shares' }),
  ];
}

// ── Financial report (fundamental metrics) ──────────────────────────────────

/**
 * Financial statements → one fact per account value, with a structured
 * `FiscalPeriod` (from the `period` label + `year`) and `asOf` = the fiscal
 * period end (`fpEnd`). Currency comes from the indicator's structured
 * `currency` field; percent-flagged accounts get a `percent` unit.
 */
export function financialReportToFacts(
  report: FinancialReport,
  options: FactFactoryOptions = {}
): FinancialFact[] {
  // Fundamental fiscal metrics are point-in-time observations, not live data.
  const shared = { ...makeBase(options), timing: options.timing ?? 'historical' };
  const facts: FinancialFact[] = [];

  for (const statement of Object.values(report.statements)) {
    if (!statement) continue;
    for (const indicator of statement.indicators) {
      for (const account of indicator.accounts) {
        facts.push(...accountToFacts(report.symbol, indicator.currency, account, shared));
      }
    }
  }
  return facts;
}

function accountToFacts(
  symbol: string,
  currency: string | undefined,
  account: FinancialReportAccount,
  shared: ReturnType<typeof makeBase>
): FinancialFact[] {
  const percent = account.percent === true;
  return account.values.map((value) =>
    valueToFact(symbol, currency, account.field, percent, value, shared)
  );
}

function valueToFact(
  symbol: string,
  currency: string | undefined,
  metric: string,
  percent: boolean,
  value: FinancialReportValue,
  shared: ReturnType<typeof makeBase>
): FinancialFact {
  const hasAsOf = value.fpEnd > 0;
  const fact: FinancialFact = {
    ...shared,
    instrumentId: symbol,
    metric,
    value: value.value,
    unit: percent ? { kind: 'percent' } : { kind: 'currency' },
    currency: percent ? undefined : currency,
    asOf: hasAsOf ? value.fpEnd : undefined,
    period: parseFiscalPeriod(value.period, value.year, value.fpEnd),
    stale: false, // point-in-time fiscal facts never become stale
  };

  const unknown: string[] = [];
  if (!percent && currency === undefined) unknown.push('currency');
  if (!hasAsOf) unknown.push('asOf');
  return unknown.length > 0 ? markUnknown(fact, ...unknown) : fact;
}

/** `period` label (`Q1 2027`, `FY2026`, `TTM`, `2026`) → structured period. */
function parseFiscalPeriod(label: string, year: number, fpEnd: number): FiscalPeriod {
  const text = (label ?? '').trim();
  const end = fpEnd > 0 ? fpEnd : undefined;

  const quarter = /Q([1-4])\s*(\d{4})/i.exec(text);
  if (quarter) {
    return {
      kind: 'quarter',
      year: Number(quarter[2]),
      quarter: Number(quarter[1]) as 1 | 2 | 3 | 4,
      end,
      label: text || undefined,
    };
  }
  if (/TTM/i.test(text)) return { kind: 'ttm', end, label: text || undefined };
  const fy = /FY\s*(\d{4})/i.exec(text);
  if (fy) return { kind: 'fy', year: Number(fy[1]), end, label: text || undefined };
  if (/^\d{4}$/.test(text)) {
    return { kind: 'annual', year: Number(text), end, label: text || undefined };
  }
  return {
    kind: 'unknown',
    year: year > 0 ? year : undefined,
    end,
    label: text || undefined,
  };
}

// ── Calc index (valuation ratios) ───────────────────────────────────────────

/** Calculated valuation indexes → structured ratio/percent/currency facts. */
export function calcIndexToFacts(index: CalcIndex, options: FactFactoryOptions = {}): FinancialFact[] {
  const shared = makeBase(options);
  const base: FactBase = {
    ...shared,
    instrumentId: index.symbol,
    asOf: undefined,
    stale: false,
  };

  const facts: FinancialFact[] = [];
  if (index.pe !== undefined) facts.push(unitFact(base, 'pe', index.pe, { kind: 'ratio' }));
  if (index.pb !== undefined) facts.push(unitFact(base, 'pb', index.pb, { kind: 'ratio' }));
  if (index.dpsRate !== undefined) facts.push(unitFact(base, 'dpsRate', index.dpsRate, { kind: 'percent' }));
  if (index.totalMarketValue !== undefined) {
    facts.push(moneyFact(base, 'totalMarketValue', index.totalMarketValue));
  }
  if (index.turnoverRate !== undefined) {
    facts.push(unitFact(base, 'turnoverRate', index.turnoverRate, { kind: 'percent' }));
  }
  if (index.ytdChangeRate !== undefined) {
    facts.push(unitFact(base, 'ytdChangeRate', index.ytdChangeRate, { kind: 'percent' }));
  }
  if (index.volumeRatio !== undefined) {
    facts.push(unitFact(base, 'volumeRatio', index.volumeRatio, { kind: 'ratio' }));
  }
  if (index.amplitude !== undefined) {
    facts.push(unitFact(base, 'amplitude', index.amplitude, { kind: 'percent' }));
  }
  return facts;
}

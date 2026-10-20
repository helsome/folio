/**
 * Deterministic time-weighted return over the real-money ledger (#335, B).
 *
 * Conventions (stated, never hidden):
 * - Returns are computed per interval between consecutive `valuation` entries
 *   and CHAINED: overall = (Π(1 + r_i)) − 1. With daily valuations this is a
 *   daily TWR.
 * - `external-flow` entries inside an interval are attributed to its BEGIN
 *   ("begin-of-interval"): deposits join the base, withdrawals leave it.
 *   r_i = (V_i − V_{i-1} − F_i) / (V_{i-1} + F_i), F_i signed in base currency.
 * - `trade` / `fee` / `dividend` are INTERNAL: they stay inside the return.
 * - FX is whatever the imported entries carry (`fxRateToBase`); nothing is
 *   looked up or re-quoted retroactively.
 * - A non-positive NAV or denominator, too few valuations, or an external
 *   flow that cannot be attributed to a valuation bracket all yield an
 *   explicit `unavailable` result. History is never back-filled from current
 *   positions and no LLM is involved.
 */
import type {
  PortfolioLedgerEntry,
  PortfolioTwrPeriod,
  PortfolioTwrResult,
} from '@finagent/core';

export const TWR_COMPUTATION_VERSION = 'twr.v1';
const FLOW_CONVENTION = 'begin-of-interval' as const;

export interface TwrOptions {
  /** The ledger revision the computation runs against (for reproducibility). */
  ledgerRevision?: number;
  /** Portfolio base currency, echoed for reproducibility when known. */
  baseCurrency?: string;
}

/** Signed flow amount in the portfolio base currency for one entry. */
function flowBase(entry: Omit<PortfolioLedgerEntry, 'id'>): number {
  const amount = entry.amount ?? 0;
  const sign = entry.direction === 'out' ? -1 : 1;
  return sign * amount * (entry.fxRateToBase ?? 1);
}

function toBase(entry: Omit<PortfolioLedgerEntry, 'id'>): number | undefined {
  const value = entry.totalValue;
  if (value === undefined) return undefined;
  return entry.fxRateToBase !== undefined ? value * entry.fxRateToBase : value;
}

export function computeTwr(
  entries: ReadonlyArray<Omit<PortfolioLedgerEntry, 'id'>>,
  options: TwrOptions = {}
): PortfolioTwrResult {
  const computation = {
    version: TWR_COMPUTATION_VERSION,
    ledgerRevision: options.ledgerRevision ?? 0,
    flowConvention: FLOW_CONVENTION,
    fxBasis: 'entry.fxRateToBase',
  };

  const valuations = entries
    .filter((entry) => entry.kind === 'valuation')
    .map((entry) => ({ at: entry.occurredAt, value: toBase(entry) }))
    .sort((a, b) => a.at - b.at);

  if (entries.length === 0) {
    return { status: 'unavailable', unavailableReason: 'no-entries', computation };
  }
  if (valuations.length < 2) {
    return { status: 'unavailable', unavailableReason: 'insufficient-valuations', computation };
  }
  if (valuations.some((point) => point.value === undefined)) {
    return { status: 'unavailable', unavailableReason: 'non-positive-nav', computation };
  }
  for (const point of valuations) {
    if ((point.value ?? 0) <= 0) {
      return { status: 'unavailable', unavailableReason: 'non-positive-nav', computation };
    }
  }

  const firstAt = valuations[0]!.at;
  const lastAt = valuations[valuations.length - 1]!.at;
  // An external flow the valuation bracket cannot attribute must NOT be
  // silently ignored (#335 B) — refuse the whole computation instead.
  const strays = entries.filter(
    (entry) =>
      entry.kind === 'external-flow' && (entry.occurredAt < firstAt || entry.occurredAt > lastAt)
  );
  if (strays.length > 0) {
    return { status: 'unavailable', unavailableReason: 'flows-outside-coverage', computation };
  }

  const periods: PortfolioTwrPeriod[] = [];
  let chained = 1;

  for (let i = 1; i < valuations.length; i += 1) {
    const start = valuations[i - 1]!;
    const end = valuations[i]!;
    const flowBaseSum = entries
      .filter(
        (entry) => entry.kind === 'external-flow' && entry.occurredAt > start.at && entry.occurredAt <= end.at
      )
      .reduce((sum, entry) => sum + flowBase(entry), 0);

    const base = (start.value ?? 0) + flowBaseSum;
    if (base <= 0) {
      return { status: 'unavailable', unavailableReason: 'non-positive-denominator', computation };
    }
    const endValue = end.value ?? 0;
    if (endValue <= 0) {
      return { status: 'unavailable', unavailableReason: 'non-positive-nav', computation };
    }
    const r = (endValue - (start.value ?? 0) - flowBaseSum) / base;
    periods.push({
      startAt: start.at,
      endAt: end.at,
      externalFlowBase: flowBaseSum,
      returnPct: r * 100,
    });
    chained *= 1 + r;
  }

  return {
    status: 'ok',
    ...(options.baseCurrency ? { baseCurrency: options.baseCurrency } : {}),
    returnPct: (chained - 1) * 100,
    periods,
    computation,
  };
}

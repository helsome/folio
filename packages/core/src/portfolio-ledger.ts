/**
 * Real-money portfolio performance ledger (#335, Phase A).
 *
 * Answers "how did MY portfolio actually perform" — as opposed to strategy
 * performance (`performance.ts`) or the current-position snapshot
 * (`account.ts`). The ledger is an append-only, import-idempotent record of
 * valuations and money events; it never back-fills history from current
 * positions and never lets an LLM compute returns.
 */

/** Kinds of ledger records. */
export type PortfolioLedgerEntryKind =
  | 'valuation'
  | 'external-flow'
  | 'trade'
  | 'fee'
  | 'dividend';

/** Direction of an external money movement (only meaningful for flows). */
export type PortfolioLedgerFlowDirection = 'in' | 'out';

/**
 * One immutable ledger record. `source` is the STABLE import identity: the
 * same `(provider, kind, externalId)` must always mean the same real-world
 * event, so re-imports deduplicate instead of double-counting (#335 A).
 */
export interface PortfolioLedgerEntry {
  /** Deterministic id derived from the import identity. */
  id: string;
  portfolioId: string;
  kind: PortfolioLedgerEntryKind;
  /** Flow direction for `external-flow`; absent otherwise. */
  direction?: PortfolioLedgerFlowDirection;
  /** Epoch ms of the event on the ledger's own timeline (not import time). */
  occurredAt: number;
  /** IANA timezone the event wall-clock belongs to, when the source knows. */
  timeZone?: string;
  /** ISO 4217 currency of `amount`. */
  currency?: string;
  /**
   * Signed amount in `currency` (negative = money leaving the account) for
   * flow/trade/fee/dividend kinds; absent for valuations.
   */
  amount?: number;
  /**
   * Multiplicative rate from `currency` into the portfolio base currency, as
   * provided by the import (never looked up retroactively). Absent when no
   * conversion applies.
   */
  fxRateToBase?: number;
  /** Total account value (market + cash) in base currency — valuations. */
  totalValue?: number;
  /** Cash balance in base currency — valuations, when reported. */
  cashBalance?: number;
  /** Position slice of the valuation, when the source provides it. */
  positions?: PortfolioLedgerPosition[];
  /** Stable import identity. */
  source: PortfolioLedgerSource;
  note?: string;
}

export interface PortfolioLedgerPosition {
  symbol: string;
  quantity?: number;
  /** Value in the position currency. */
  marketValue?: number;
  currency?: string;
}

export interface PortfolioLedgerSource {
  /** Importing provider/system, e.g. `longbridge`, `manual-import`. */
  provider: string;
  /** Source record classification, e.g. `cash-flow`, `snapshot`. */
  kind: string;
  /** Source-stable id of the record (vendor id, hash of the row, ...). */
  externalId: string;
}

/** Ledger state for one portfolio, persisted as one JSON document. */
export interface PortfolioLedger {
  portfolioId: string;
  /** Deduplicated entries ordered by `occurredAt`. */
  entries: PortfolioLedgerEntry[];
  /** Monotonic counter bumped by every mutation (import or correction). */
  revision: number;
  /** Prior versions of corrected entries, keyed by entry id. */
  history: Record<string, PortfolioLedgerEntry[]>;
}

/** Data-readiness summary for the ledger UI (#335 A). */
export interface PortfolioLedgerCoverage {
  portfolioId: string;
  firstEntryAt?: number;
  lastEntryAt?: number;
  counts: Partial<Record<PortfolioLedgerEntryKind, number>>;
  revision: number;
}

export interface PortfolioLedgerImportResult {
  portfolioId: string;
  /** New entries created by this batch. */
  added: number;
  /** Entries corrected (same identity, different content). */
  corrected: number;
  /** Entries skipped as byte-identical re-imports (idempotency proof). */
  skipped: number;
  ledgerRevision: number;
}

// ── TWR result contracts (Phase B) ─────────────────────────────────────────

/**
 * Why a TWR computation refused to answer. Every unavailable case is explicit
 * — the calculator NEVER back-fills history from current positions, invents
 * prices, or silently ignores flows it cannot attribute (#335 B).
 */
export type PortfolioTwrUnavailableReason =
  | 'no-entries'
  | 'insufficient-valuations'
  | 'non-positive-nav'
  | 'non-positive-denominator'
  | 'flows-outside-coverage';

/** One chained sub-period between consecutive valuation points. */
export interface PortfolioTwrPeriod {
  /** Interval start (inclusive) — epoch ms of the previous valuation. */
  startAt: number;
  /** Interval end — epoch ms of this valuation. */
  endAt: number;
  /** External flows attributed to this interval, base currency (signed). */
  externalFlowBase: number;
  /** Interval return in percent, computed with begin-of-interval flows. */
  returnPct: number;
}

export interface PortfolioTwrResult {
  status: 'ok' | 'unavailable';
  unavailableReason?: PortfolioTwrUnavailableReason;
  baseCurrency?: string;
  /** Chained total return in percent: (Π(1 + r_i)) − 1. */
  returnPct?: number;
  /** Chained sub-periods; `periods` multiply to `returnPct`. */
  periods?: PortfolioTwrPeriod[];
  /**
   * Reproducibility record (#335 acceptance): computation version, the ledger
   * revision it ran against, the flow convention, and the FX basis.
   */
  computation: {
    version: string;
    ledgerRevision: number;
    flowConvention: 'begin-of-interval';
    /** How FX was applied, e.g. `entry.fxRateToBase` or `none`. */
    fxBasis: string;
  };
}

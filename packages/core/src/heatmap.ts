import type { Holding } from './account.ts';
import type { CanonicalInstrument } from './instrument.ts';
import type { ProviderProvenance, ProviderResult } from './provider.ts';
import type { Quote } from './index.ts';

/** Inputs already bound to one versioned watchlist/portfolio snapshot. */
export interface HeatmapEntry {
  instrument: CanonicalInstrument;
  sector?: string;
  quote?: ProviderResult<Quote>;
  /** One lot; repeated canonical instruments are aggregated in portfolio mode. */
  holding?: Pick<Holding, 'quantity' | 'currency' | 'marketValue' | 'marketValueBase'>;
}

export type HeatmapInput = {
  snapshotId: string;
  entries: readonly HeatmapEntry[];
} & (
  | { mode: 'watchlist' }
  | { mode: 'portfolio'; baseCurrency?: string }
);

export type HeatmapQuoteStatus =
  | 'available'
  | 'delayed'
  | 'stale'
  | 'missing'
  | 'error'
  | 'identity-mismatch'
  | 'identity-unknown';

export type HeatmapWeightIssue =
  | 'missing-base-currency'
  | 'missing-valuation'
  | 'unsupported-short'
  | 'invalid-total';

export interface HeatmapCell {
  instrumentId: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  /** null means unknown, rather than a made-up industry. */
  sector: string | null;
  /** null means unavailable; an actual flat quote is 0. Stale values remain labelled. */
  changePercent: number | null;
  quoteStatus: HeatmapQuoteStatus;
  /** Original epoch seconds from Quote; never replaced with render time. */
  quoteTimestamp?: number;
  provenance?: ProviderProvenance;
  errorCode?: string;
  /** Fraction of the full snapshot, 0..1. null disables area encoding. */
  areaWeight: number | null;
  weightIssues: HeatmapWeightIssue[];
}

export interface HeatmapSnapshot {
  snapshotId: string;
  mode: HeatmapInput['mode'];
  baseCurrency?: string;
  /** Unavailable when any portfolio lot is not safely comparable/long-only. */
  weightsAvailable: boolean;
  weightIssues: HeatmapWeightIssue[];
  groups: Array<{ sector: string | null; cells: HeatmapCell[] }>;
}

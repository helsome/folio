/**
 * Compare domain — structured cross-symbol comparison built from capability
 * data. Cells that have no data are explicit (`missing: true`), never inferred.
 */

export interface ComparisonCell {
  value?: string | number;
  /** Formatted value for display; "—" when missing. */
  display: string;
  missing: boolean;
}

export interface ComparisonRow {
  /** Metric label, e.g. `Price`, `Market Cap`, `PE`, `Revenue Growth`. */
  metric: string;
  /** symbol → cell. */
  cells: Record<string, ComparisonCell>;
}

/** A base-100 close value; null marks a missing trading date and must render as a gap. */
export interface ComparisonPricePoint {
  timestamp: number;
  value: number | null;
}

/** Deterministic normalized closes ready for the Compare price-history chart. */
export interface ComparisonPriceHistory {
  /** Earliest timestamp with a valid close for every compared symbol. */
  commonStartTimestamp: number | null;
  /** Each symbol shares the same timestamp grid; null values preserve market-data gaps. */
  series: Record<string, ComparisonPricePoint[]>;
}

export interface Comparison {
  symbols: string[];
  rows: ComparisonRow[];
  generatedAt: number;
  /** symbol → fetch error message (rows still render with missing cells). */
  errors: Record<string, string>;
  /** Optional for compatibility with older persisted/IPC comparison payloads. */
  priceHistory?: ComparisonPriceHistory;
}

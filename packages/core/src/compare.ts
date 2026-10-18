/**
 * Compare domain — structured cross-symbol comparison built from capability
 * data. Cells that have no data are explicit (`missing: true`), never inferred.
 */

import type { CapabilityProvenance } from './capability.ts';

export interface ComparisonCell {
  value?: string | number;
  /** Formatted value for display; "—" when missing. */
  display: string;
  missing: boolean;
  /**
   * Provenance of the capability result this cell was built from — the same
   * record that produced `value`, never re-stamped. Absent when the producing
   * run carried no provenance; consumers must show `unknown`, not assume a
   * provider. A mixed table therefore keeps per-cell sources instead of one
   * table-level badge.
   */
  provenance?: CapabilityProvenance;
}

export interface ComparisonRow {
  /** Metric label, e.g. `Price`, `Market Cap`, `PE`, `Revenue Growth`. */
  metric: string;
  /** symbol → cell. */
  cells: Record<string, ComparisonCell>;
}

export interface Comparison {
  symbols: string[];
  rows: ComparisonRow[];
  generatedAt: number;
  /** symbol → fetch error message (rows still render with missing cells). */
  errors: Record<string, string>;
  /** Display names of the providers that actually supplied quote or candle data. */
  sources?: string[];
  /** True when any contributing market-data source is delayed. */
  delayed?: boolean;
}

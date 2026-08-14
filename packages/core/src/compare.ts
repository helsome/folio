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

export interface Comparison {
  symbols: string[];
  rows: ComparisonRow[];
  generatedAt: number;
  /** symbol → fetch error message (rows still render with missing cells). */
  errors: Record<string, string>;
}

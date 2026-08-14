/**
 * V5 Research Diff domain (spec §17–20).
 *
 * Re-researching the same security compares the NEW structured report against
 * the PREVIOUS one. The diff is deterministic field-level first, with an
 * optional agent interpretation layer; never free-form LLM comparison of two
 * markdown blobs.
 */

export type DiffCategory =
  | 'valuation'
  | 'financials'
  | 'technical'
  | 'analyst-rating'
  | 'momentum'
  | 'earnings'
  | 'news'
  | 'risk'
  | 'growth'
  | 'sentiment';

export type DiffDirection = 'improved' | 'worsened' | 'unchanged' | 'new' | 'removed';

/** One structured change between two reports. */
export interface ResearchChange {
  category: DiffCategory;
  /** Deterministic label, e.g. 'PE ratio'. */
  label: string;
  before?: string | number;
  after?: string | number;
  direction: DiffDirection;
  /** Whether this change crosses the materiality bar (drives automation). */
  material: boolean;
  /** Evidence notes, e.g. capability-run ids or quote timestamps. */
  evidence: string[];
}

export interface ResearchDiff {
  id: string;
  symbol: string;
  previousReportId: string;
  currentReportId: string;
  generatedAt: number;
  changes: ResearchChange[];
  /** True when at least one change is material. */
  material: boolean;
  /** Optional agent-written summary (local deterministic when agent absent). */
  summary?: string;
  /** Rendered by the thesis service when a thesis exists for this symbol. */
  thesisImpact?: {
    direction: 'unchanged' | 'strengthened' | 'weakened' | 'invalidated';
    summary: string;
  };
}

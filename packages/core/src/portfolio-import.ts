/**
 * V5 Portfolio Import domain (spec §43–49).
 *
 * Importing a portfolio ALWAYS produces a draft first; the user confirms
 * before anything is written. AI/vision extraction and manual parses both go
 * through the same confirm gate. Manual portfolios are a separate account
 * from broker-synced ones — never merged into one indistinguishable blob.
 */
import type { Holding } from './account.ts';

export type ImportSource = 'csv' | 'paste' | 'screenshot';

export interface PortfolioImportRow {
  symbol: string;
  name?: string;
  quantity?: number;
  costPrice?: number;
  currency?: string;
  account?: string;
  /** 0..1 extraction confidence; low rows require user review (spec §48). */
  confidence: number;
  /** User-safe issue descriptions; malformed imports fail cleanly (spec §103). */
  issues: string[];
}

export interface PortfolioImportDraft {
  id: string;
  source: ImportSource;
  rows: PortfolioImportRow[];
  importedAt: number;
  /** Human-readable summary of skipped/ambiguous content. */
  warnings: string[];
}

/** A user-managed portfolio (distinct from broker-synced accounts, spec §49). */
export interface ManualPortfolio {
  id: string;
  name: string;
  currency?: string;
  holdings: Holding[];
  updatedAt: number;
}

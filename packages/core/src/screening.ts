/**
 * V5 Discover / Screening domain (spec §5–10).
 *
 * Task-driven discover, NOT a Bloomberg-style screener: the user picks a
 * task (momentum, low valuation, upcoming earnings, …), the provider layer
 * fetches structured data for a bounded universe, deterministic filters and
 * scoring produce a shortlist, and only THEN may an agent (optionally)
 * re-rank. The LLM never scans the whole market (spec §7).
 */

/** Discover tasks (spec §5). */
export type ScreeningStrategy =
  | 'top-gainers'
  | 'top-losers'
  | 'high-volume'
  | 'unusual-movement'
  | 'low-valuation'
  | 'high-roe'
  | 'revenue-growth'
  | 'high-dividend'
  | 'quality-growth'
  | 'strong-momentum'
  | 'breakout'
  | 'oversold'
  | 'trend-reversal'
  | 'upcoming-earnings'
  | 'rating-changes'
  | 'news-surge'
  | 'dividend-events';

export interface ScreeningQuery {
  strategy: ScreeningStrategy;
  /** Bounded universe; empty = the provider's default pool. */
  universe?: string[];
  market?: string;
  filters?: Record<string, unknown>;
  limit: number;
}

/** One shortlisted security with deterministic reasons + evidence. */
export interface ScreeningCandidate {
  symbol: string;
  name: string;
  market?: string;
  /** 0..1 deterministic score; absent when the strategy is binary. */
  score?: number;
  /** Human-readable reasons, e.g. '5d return +8.2%', 'PE 9.4'. */
  reasons: string[];
  metrics: Record<string, string | number | undefined>;
  /** Capability-run ids backing the metrics (evidence trail). */
  evidence: string[];
}

/** A persisted screening run — the basis for future outcome evaluation. */
export interface ScreeningRun {
  id: string;
  strategy: ScreeningStrategy;
  query: Omit<ScreeningQuery, 'strategy'>;
  /** Provider ids that actually served data. */
  providers: string[];
  createdAt: number;
  candidates: ScreeningCandidate[];
  /** Capability failures: capabilityId → user-safe message. */
  failures: Record<string, string>;
}

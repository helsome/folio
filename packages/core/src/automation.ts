/**
 * V5 Scheduled Research / Automation domain (spec §21–25).
 *
 * First version supports five fixed automations — no arbitrary cron. The
 * material-change filter is the differentiator: only securities whose
 * lightweight refresh shows a material change trigger expensive analysis and
 * notifications.
 */
import type { StrategyId } from './strategy.ts';

export type AutomationType =
  | 'watchlist-daily-review'
  | 'portfolio-daily-brief'
  | 'weekly-thesis-review'
  | 'pre-earnings-research'
  | 'post-earnings-research';

export interface AutomationRule {
  id: string;
  type: AutomationType;
  enabled: boolean;
  /** Hour-of-day (local); daily briefs run after market close by default. */
  hour?: number;
  /** Days of week (0=Sun … 6=Sat); empty = every day. */
  days?: number[];
  /** Scope override; empty = derive from type (watchlist/portfolio/theses). */
  symbols?: string[];
  strategyId?: StrategyId;
  /** `material-only` is the default and the point of the system (spec §24). */
  notify: 'material-only' | 'all';
  createdAt: number;
}

/** One execution of an automation rule. */
export type AutomationRunOutcome = 'material_update' | 'no_material_update' | 'incomplete';

export type AutomationScopeKind = 'rule' | 'hook' | 'watchlist' | 'portfolio' | 'thesis';

/** Minimal, immutable record of the securities a run evaluated. */
export interface AutomationScopeSnapshot {
  kind: AutomationScopeKind;
  symbols: string[];
  /** When this run captured the scope. */
  capturedAt: number;
  /**
   * Epoch ms when the portfolio provider fetched this membership snapshot.
   * The automation runner accepts it only when it falls on the same local
   * calendar day as the run — a previous day's book cannot support
   * `no_material_update`. Absent on non-portfolio scopes and on older runs.
   */
  sourceFetchedAt?: number;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  ranAt: number;
  /** Securities evaluated by the lightweight refresh. */
  evaluated: number;
  /** Securities that crossed the material-change bar. */
  materialChanges: number;
  /** Securities that got the expensive analysis. */
  analyzed: number;
  notified: boolean;
  failures: string[];
  /** Older persisted runs omit this field. */
  outcome?: AutomationRunOutcome;
  /** The scope is frozen at execution time; older runs omit this field. */
  scopeSnapshot?: AutomationScopeSnapshot;
}

/** Material-change signals, first version (spec §25) — deterministic, never LLM-per-minute. */
export interface MaterialChangeSignals {
  /** Abs change % vs previous close. */
  priceMovePct?: number;
  ratingChanged: boolean;
  earningsAnnounced: boolean;
  majorNews: boolean;
  financialChange: boolean;
  regimeChanged: boolean;
  newRisk: boolean;
  diffSeverity?: 'minor' | 'moderate' | 'major';
}

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

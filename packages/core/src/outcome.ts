/**
 * V5 Outcome Evaluation domain (spec §29–38).
 *
 * Every research run emits a ResearchOpinion (what did we think), snapshotted
 * with entry data at creation time so future evaluation never pollutes the
 * past judgment. When the horizon is reached, the Outcome Engine compares the
 * opinion against historical market data and records a ResearchOutcome.
 */

export type OpinionStance = 'bullish' | 'bearish' | 'neutral';

export type OpinionHorizon = '1w' | '1m' | '3m';

export interface ResearchOpinion {
  id: string;
  reportId: string;
  symbol: string;
  strategyId?: string;
  skillIds: string[];
  stance: OpinionStance;
  /** 0..1. */
  confidence: number;
  horizon: OpinionHorizon;
  createdAt: number;
  /** Entry snapshot — never backfilled later (spec §31). */
  entryPrice?: number;
  marketRegime?: string;
  provider?: string;
  dataTimestamp?: number;
  evidenceRefs: string[];
}

export type OutcomeStatus = 'evaluated' | 'unable';

export interface ResearchOutcome {
  id: string;
  opinionId: string;
  horizon: OpinionHorizon;
  evaluatedAt: number;
  entryPrice?: number;
  exitPrice?: number;
  /** Signed percent, e.g. 2.4 for +2.4%. */
  returnPercent?: number;
  /** Signed percent of the benchmark over the same window, when available. */
  benchmarkReturn?: number;
  /** Whether the move matched the opinion's directional expectation. */
  directionCorrect?: boolean;
  maximumDrawdown?: number;
  status: OutcomeStatus;
  /** Why evaluation was impossible (no price data, delisted, …). */
  reason?: string;
  /** Version of the evaluation rules that produced this outcome (spec §34). */
  outcomeEngineVersion: string;
}

export const OUTCOME_ENGINE_VERSION = '1.0.0';

/** Below this sample count, performance views show Observational Only (spec §38). */
export const MIN_EVALUATED_SAMPLES = 30;

/** Per-stance expectation model (spec §34) — versioned with the engine. */
export type OutcomeExpectation =
  | { kind: 'bullish'; positiveReturn: boolean }
  | { kind: 'bearish'; negativeReturn: boolean }
  | { kind: 'neutral'; bounded: boolean };

import type { EvidenceRef } from './research.ts';

/**
 * Investment Thesis domain — the durable "what did you believe before" state
 * that monitoring and re-evaluation act on.
 */

export type ThesisStance = 'bullish' | 'bearish' | 'neutral';

export interface InvestmentThesis {
  id: string;
  symbol: string;
  stance: ThesisStance;
  /** Core thesis statement. */
  summary: string;
  bullCase: string[];
  bearCase: string[];
  catalysts: string[];
  risks: string[];
  targetPrice?: number;
  /** Evidence links from the research that produced (or last updated) this thesis. */
  evidenceRefs: EvidenceRef[];
  createdAt: number;
  updatedAt: number;
  lastReviewedAt: number;
}

export type ThesisImpactKind = 'unchanged' | 'strengthened' | 'weakened' | 'invalidated';

/**
 * The outcome of a thesis re-evaluation: how new facts (a triggered alert,
 * fresh market data, a new report) affect the existing thesis, plus the
 * updated thesis snapshot.
 */
export interface ThesisImpact {
  id: string;
  thesisId: string;
  symbol: string;
  evaluatedAt: number;
  kind: ThesisImpactKind;
  /** Agent-written explanation, e.g. "The rating downgrade weakens your thesis because…". */
  summary: string;
  /** Set when the re-evaluation was triggered by an alert event. */
  trigger?: {
    ruleId: string;
    ruleType: string;
    eventId?: string;
  };
  evidence: EvidenceRef[];
  /** Thesis snapshot after this re-evaluation was applied. */
  thesis: InvestmentThesis;
}

/** Facts handed to the impact evaluator: the old thesis + fresh data. */
export interface ThesisImpactInput {
  thesis: InvestmentThesis;
  trigger?: { ruleId: string; ruleType: string; eventId?: string };
  /** Formatted structured-data bundle for the thesis symbol (fresh fetches). */
  dataBundle: string;
  /** Per-capability outcomes of the fresh fetches. */
  runs: Array<{
    capabilityId: string;
    status: 'success' | 'failed' | 'unavailable' | 'cancelled';
    summary?: string;
    error?: string;
  }>;
}

/**
 * Compares the old thesis against current facts and produces an impact
 * verdict + an updated thesis. Default implementation drives the agent
 * kernel; a deterministic local implementation backs tests.
 */
export interface ThesisImpactEvaluator {
  evaluate(
    input: ThesisImpactInput,
    signal?: AbortSignal
  ): Promise<{ kind: ThesisImpactKind; summary: string; updatedThesis: InvestmentThesis }>;
}

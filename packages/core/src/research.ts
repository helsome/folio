import type { CapabilityProvenance, CapabilityRunStatus } from './capability.ts';
import type { SupportedLocale } from './locale.ts';

/**
 * Research domain — Deep Research runs, evidence-backed reports, and the
 * synthesizer contract that turns capability facts into an analysis.
 */

export type ResearchStance = 'bullish' | 'bearish' | 'neutral';

export type ResearchRunStatus =
  | 'queued'
  | 'fetching'
  | 'synthesizing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type ResearchVerdict = 'positive' | 'negative' | 'neutral' | 'unavailable';

/**
 * A claim in the report linked to the exact capability run that produced the
 * underlying fact. LLM prose is never the source of truth — evidence is.
 */
export interface EvidenceRef {
  capabilityId: string;
  /** CapabilityRunRecord.id of the run this evidence comes from. */
  runId: string;
  /** The claim this evidence supports, e.g. "NVDA valuation is expensive". */
  claim: string;
  fetchedAt: number;
  /** Short factual summary of the data point (from CapabilityResult.summary). */
  summary?: string;
}

/** Condensed outcome of one capability run, embedded in the report. */
export interface CapabilityRunSummary {
  runId: string;
  capabilityId: string;
  status: CapabilityRunStatus;
  fetchedAt?: number;
  marketTime?: number;
  error?: string;
}

export interface ResearchSection {
  /** Stable key, e.g. `valuation`, `fundamentals`, `technical`, `news`, `momentum`. */
  key: string;
  title: string;
  verdict: ResearchVerdict;
  /** Synthesized analysis text for this dimension. */
  summary: string;
  evidence: EvidenceRef[];
}

export interface ResearchReport {
  id: string;
  symbol: string;
  generatedAt: number;
  /** V5: research strategy that produced this report (spec §100). */
  strategyId?: string;
  /**
   * Locale that produced this report, stamped at generation time (V8 spec
   * §44–46). Absent on legacy reports = as-generated; the report's prose is
   * never translated, this only records which language it was written in.
   */
  locale?: SupportedLocale;
  summary: string;
  stance: ResearchStance;
  /** 0..1. */
  confidence: number;
  sections: ResearchSection[];
  bullCase: string[];
  bearCase: string[];
  catalysts: string[];
  risks: string[];
  capabilityRuns: CapabilityRunSummary[];
  /**
   * `completed` when every planned capability succeeded; `partial` when some
   * failed or were unavailable — the report still stands, gaps are explicit.
   */
  runStatus: ResearchRunStatus;
}

/** Lightweight progress record for the Research UI. */
export interface ResearchRunSummary {
  id: string;
  symbol: string;
  status: ResearchRunStatus;
  startedAt: number;
  finishedAt?: number;
  reportId?: string;
  plannedCapabilities: string[];
  completedCapabilities: string[];
  failedCapabilities: string[];
  cancelled?: boolean;
}

/**
 * Facts handed to the synthesizer: the condensed data bundle (structured data,
 * not prose) plus the per-capability run outcomes.
 */
export interface ResearchSynthesisInput {
  symbol: string;
  plannedCapabilities: string[];
  runs: Array<{
    capabilityId: string;
    status: CapabilityRunStatus;
    summary?: string;
    provenance?: CapabilityProvenance;
    error?: string;
  }>;
  /** Formatted structured-data bundle built from CapabilityResult.data values. */
  dataBundle: string;
}

export interface ResearchSynthesis {
  summary: string;
  stance: ResearchStance;
  confidence: number;
  sections: Array<{
    key: string;
    title: string;
    verdict: ResearchVerdict;
    summary: string;
  }>;
  bullCase: string[];
  bearCase: string[];
  catalysts: string[];
  risks: string[];
}

/**
 * Turns capability facts into the analysis parts of a ResearchReport.
 * Default implementation drives the agent kernel; a deterministic local
 * implementation backs tests and the LocalRuntime path.
 */
export interface ResearchSynthesizer {
  synthesize(input: ResearchSynthesisInput, signal?: AbortSignal): Promise<ResearchSynthesis>;
}

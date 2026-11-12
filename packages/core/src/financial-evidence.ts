import type { FinancialFactCandidate, ReconciliationState } from './reconciliation.ts';

/** Machine-readable lineage for structured financial facts used by Copilot. */

export const FINANCIAL_EVIDENCE_SCHEMA_VERSION = 'financial-evidence/v1' as const;
export const FINANCIAL_NORMALIZATION_VERSION = 'folio-normalization/v1' as const;

export type FinancialEvidenceKind = 'quote' | 'fundamental' | 'historical' | 'portfolio' | 'other';

export interface FinancialEvidenceValue {
  /** Stable field identity inside the normalized result, e.g. `lastPrice` or `bars.0.close`. */
  metric: string;
  originalValue: unknown;
  normalizedValue: unknown;
  unit?: string;
  currency?: string;
  period?: string;
  /** Epoch milliseconds — payload-native seconds are normalized at the evidence boundary. */
  asOf?: number;
}

export interface FinancialEvidenceLineageStep {
  kind: 'provider' | 'cache' | 'fallback' | 'normalization' | 'conversion' | 'derivation' | 'reconciliation';
  description: string;
  version?: string;
  inputEvidenceIds?: string[];
}

/** Optional adapter-supplied details needed to prove normalization/conversion. */
export interface FinancialEvidenceMetadata {
  rawValues?: Record<string, unknown>;
  units?: Record<string, string>;
  currencies?: Record<string, string>;
  periods?: Record<string, string>;
  lineage?: FinancialEvidenceLineageStep[];
  dataset?: string;
  cacheHit?: boolean;
  fallback?: FinancialEvidenceEnvelope['fallback'];
  reconciliation?: FinancialEvidenceReconciliation;
}

/**
 * Provider disagreement recorded on a persisted fact.
 *
 * `providers` + `method` is the original shape. `state` and `candidates` are
 * additive: a material conflict keeps every candidate and never replaces them
 * with an average. Older records that only stored providers/method stay valid.
 */
export interface FinancialEvidenceReconciliation {
  providers: string[];
  method: string;
  state?: ReconciliationState;
  candidates?: FinancialFactCandidate[];
  discrepancy?: number;
  selectedProvider?: string;
  /** Verbatim reconciler explanation, when the producer supplied one. */
  reason?: string;
}

export interface FinancialEvidenceEnvelope {
  schemaVersion: typeof FINANCIAL_EVIDENCE_SCHEMA_VERSION;
  normalizationVersion: typeof FINANCIAL_NORMALIZATION_VERSION;
  id: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  kind: FinancialEvidenceKind;
  instrumentId?: string;
  capabilityId?: string;
  provider: string;
  dataset?: string;
  query: Record<string, unknown>;
  values: FinancialEvidenceValue[];
  retrievedAt: number;
  asOf?: number;
  stale: boolean;
  /** True when the provider reported a delayed value rather than live data. */
  delayed?: boolean;
  cacheHit: boolean;
  fallback?: { from: string; to: string; reason?: string };
  reconciliation?: FinancialEvidenceReconciliation;
  resultSnapshot: unknown;
  resultHash: string;
  lineage: FinancialEvidenceLineageStep[];
}

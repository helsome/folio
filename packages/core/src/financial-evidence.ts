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
  reconciliation?: FinancialEvidenceEnvelope['reconciliation'];
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
  cacheHit: boolean;
  fallback?: { from: string; to: string; reason?: string };
  reconciliation?: { providers: string[]; method: string };
  resultSnapshot: unknown;
  resultHash: string;
  lineage: FinancialEvidenceLineageStep[];
}

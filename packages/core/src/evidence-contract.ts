/**
 * Unified evidence contract — Source → Evidence ↔ Claim → Answer/Report.
 *
 * Folio evolved several parallel evidence shapes: FinancialEvidenceEnvelope
 * for Copilot tool facts, EvidenceRef for research-report claims, NewsItem
 * for web/news. This module defines ONE versioned contract they all project
 * into without deleting their domain-specific fields. It is a contract
 * integration, not a new evidence framework: existing types stay authoritative
 * for their producers, and projections are additive. See
 * docs/evidence-contract.md for the identity and lifecycle semantics.
 */

export const EVIDENCE_CONTRACT_SCHEMA_VERSION = 'folio-evidence-contract/v1' as const;

/** Where a source came from. */
export type EvidenceSourceKind =
  | 'structured_finance'
  | 'filing'
  | 'news'
  | 'web'
  | 'tool'
  | 'other';

/** Coarse source class for downstream authority ranking; ranking itself is out of scope. */
export type EvidenceSourceClass =
  | 'regulator'
  | 'exchange'
  | 'issuer'
  | 'press'
  | 'aggregator'
  | 'tool'
  | 'other';

export interface EvidenceSource {
  /** Stable identity, derived deterministically from kind + origin + canonicalUrl/query. */
  sourceId: string;
  kind: EvidenceSourceKind;
  /** Publisher / provider identity, e.g. `longbridge`, `reuters`, `sec.gov`. */
  publisher?: string;
  /**
   * Canonical public URL when the source has one. Never synthesized for
   * structured finance data — absence of a URL is meaningful there; its
   * identity is publisher + dataset + query instead.
   */
  canonicalUrl?: string;
  /** Epoch ms at which this source was retrieved by Folio. */
  retrievedAt: number;
  /** Epoch ms the source itself was published, when known. */
  publishedAt?: number;
  /** Lightweight authority metadata; only set when actually known, never guessed. */
  authority?: {
    /** True for regulator / exchange / issuer primary sources. */
    primary: boolean;
    sourceClass: EvidenceSourceClass;
  };
  /** Domain-specific provider metadata preserved verbatim as a nested extension. */
  providerMeta?: Record<string, unknown>;
}

export type EvidenceItemKind =
  | 'structured_value'
  | 'text_excerpt'
  | 'table_row'
  | 'tool_result';

export type EvidenceAvailability = 'available' | 'conflicted' | 'unavailable';

/** Financial semantics retained when projecting structured finance facts. */
export interface FinancialEvidenceSemantics {
  /** Canonical instrument id this fact belongs to. */
  instrumentId?: string;
  /** Stable field identity, e.g. `lastPrice` or `bars.0.close`. */
  metric: string;
  value: unknown;
  /** Provider-side value before normalization, when tracked. */
  originalValue?: unknown;
  unit?: string;
  currency?: string;
  period?: string;
  asOf?: number;
}

/** Document semantics retained when projecting text / web / filing evidence. */
export interface DocumentEvidenceExcerpt {
  text: string;
  /** Where the excerpt lives in the source, e.g. `paragraph.3` or `row.12`. */
  location?: string;
}

export interface EvidenceFreshness {
  retrievedAt: number;
  /** Market-time of the fact itself, when known. */
  asOf?: number;
  stale: boolean;
}

export interface EvidenceItem {
  /** Stable identity, derived deterministically from sourceId + kind + content. */
  evidenceId: string;
  /** The source this evidence was extracted from. */
  sourceId: string;
  kind: EvidenceItemKind;
  /** Present when the evidence carries financial semantics. */
  financial?: FinancialEvidenceSemantics;
  /** Present when the evidence carries document/text semantics. */
  excerpt?: DocumentEvidenceExcerpt;
  freshness: EvidenceFreshness;
  /** Conflicts and unavailability are explicit states, never silently dropped. */
  availability: EvidenceAvailability;
  /** Origin provenance preserved from the producing subsystem. */
  provenance: {
    runId?: string;
    toolCallId?: string;
    toolName?: string;
    capabilityId?: string;
    provider?: string;
    /** Scoping instrument for non-financial evidence (news about a listing). */
    instrumentId?: string;
    /**
     * Original producer-side evidence record id (e.g. the `fe_` envelope id of
     * a Copilot turn), so pre-contract citations can be joined to contract
     * items deterministically.
     */
    envelopeId?: string;
  };
}

export type ClaimVerificationStatus =
  | 'unverified'
  | 'supported'
  | 'contradicted'
  | 'insufficient_evidence';

export interface EvidenceClaim {
  /** Stable identity, derived deterministically from the statement + scope. */
  claimId: string;
  /** The claim statement, e.g. "NVDA valuation is expensive". */
  statement: string;
  /**
   * Evidence backing this claim — many-to-many. One claim may cite many
   * items and one item may back many claims: claims reference evidence
   * one-way, evidence never names its claims.
   */
  evidenceIds: string[];
  verification: ClaimVerificationStatus;
  /** Which verifier (and version) produced the status, when verified. */
  verifiedBy?: string;
}

export interface EvidenceBundle {
  schemaVersion: typeof EVIDENCE_CONTRACT_SCHEMA_VERSION;
  sources: EvidenceSource[];
  evidence: EvidenceItem[];
  claims: EvidenceClaim[];
}

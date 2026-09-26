/** Structured disclosure metadata. Dates are ISO-8601; no inferred fiscal periods. */
export type ResearchSourceType = 'regulatory_filing' | 'exchange_announcement' | 'ir_document' | 'earnings_release' | 'research_report' | 'other';

export interface DocumentEvidence {
  evidenceId: string;
  documentId: string;
  url: string;
  section?: string;
  page?: number;
  /** Offsets in normalized extracted text, not in the original HTML. */
  span: { start: number; end: number };
  quote: string;
  contentHash: string;
}

export interface ResearchDocument {
  documentId: string;
  issuerId: string;
  instrumentId?: string;
  sourceType: ResearchSourceType;
  subtype: string;
  title: string;
  publishedAt: string;
  filedAt?: string;
  reportingPeriod?: { end: string; start?: string };
  authority: string;
  publisher: string;
  canonicalUrl: string;
  providerId: string;
  language: string;
  version: { isAmendment: boolean; familyId: string; amendsDocumentId?: string };
  provenance: { fetchedAt: number; discoveryUrl: string; providerDocumentId: string };
  licensing: { access: 'public' | 'licensed'; fullTextAllowed: boolean; telemetryAllowed: boolean };
  evidence: DocumentEvidence[];
}

export interface ResearchDocumentQuery {
  symbol: string;
  /** SEC issuer identity, for issuers outside the initial symbol catalog. */
  cik?: string;
  subtype?: string;
  periodEnd?: string;
  publishedFrom?: string;
  publishedTo?: string;
  authority?: string;
  limit?: number;
  /** Optional bounded evidence extraction from up to two matching documents. */
  evidenceQuery?: string;
}

export interface ResearchDocumentResult {
  documents: ResearchDocument[];
  sources: Array<{ providerId: string; status: 'ok' | 'unavailable' | 'failed'; coverage: string; error?: string }>;
}

/** Licensed research must never silently reuse a primary-source connector. */
export interface ResearchReportAdapter {
  providerId: string;
  sourceType: 'research_report';
  licensing: { access: 'licensed'; fullTextAllowed: boolean; telemetryAllowed: false; termsUrl: string };
  search(query: ResearchDocumentQuery, signal?: AbortSignal): Promise<ResearchDocument[]>;
}

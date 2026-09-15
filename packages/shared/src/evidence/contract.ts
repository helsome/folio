import { createHash } from 'node:crypto';
import type {
  EvidenceBundle,
  EvidenceClaim,
  EvidenceItem,
  EvidenceRef,
  EvidenceSource,
  FinancialEvidenceEnvelope,
  NewsItem,
} from '@finagent/core';
import {
  EVIDENCE_CONTRACT_SCHEMA_VERSION,
  type EvidenceSourceClass,
  type EvidenceSourceKind,
} from '@finagent/core';

/**
 * Projections from the pre-contract evidence shapes into the unified
 * Source → Evidence ↔ Claim contract (packages/core/src/evidence-contract.ts).
 *
 * Identity rules (docs/evidence-contract.md):
 * - sourceId: derived from kind + origin (publisher / url / query), NOT from
 *   retrieval time — the same document or query observed twice is one source.
 * - evidenceId: derived from sourceId + kind + content + retrievedAt — the
 *   same fact re-observed later is a new observation of the same source, and
 *   keeps its own provenance.
 * - claimId: derived from the statement (+ instrument scope) — identical
 *   claims from different runs merge in the bundle and union their evidence.
 *
 * Inputs are the existing persisted types, taken read-only; projections never
 * mutate them, so already-persisted records stay readable (no migration).
 */

export interface FinancialEvidenceProjection {
  sources: EvidenceSource[];
  evidence: EvidenceItem[];
}

/** Project Copilot structured finance envelopes into contract sources + evidence. */
export function projectFinancialEvidence(
  envelopes: FinancialEvidenceEnvelope[]
): FinancialEvidenceProjection {
  const sources: EvidenceSource[] = [];
  const evidence: EvidenceItem[] = [];
  for (const envelope of envelopes) {
    const sourceId = deriveSourceId('structured_finance', {
      publisher: envelope.provider,
      dataset: envelope.dataset,
      instrumentId: envelope.instrumentId,
      query: envelope.query,
    });
    sources.push({
      sourceId,
      kind: 'structured_finance',
      publisher: envelope.provider,
      // No canonicalUrl: structured finance data has no public document —
      // fabricating one would corrupt the citation contract.
      retrievedAt: envelope.retrievedAt,
      providerMeta: {
        toolName: envelope.toolName,
        cacheHit: envelope.cacheHit,
        ...(envelope.fallback ? { fallback: envelope.fallback } : {}),
        ...(envelope.reconciliation ? { reconciliation: envelope.reconciliation } : {}),
      },
    });
    for (const value of envelope.values) {
      evidence.push({
        evidenceId: deriveEvidenceId(sourceId, 'structured_value', [
          value.metric,
          stableJson(value.normalizedValue),
          value.period ?? '',
          String(value.asOf ?? ''),
        ], envelope.retrievedAt),
        sourceId,
        kind: 'structured_value',
        financial: {
          ...(envelope.instrumentId ? { instrumentId: envelope.instrumentId } : {}),
          metric: value.metric,
          value: value.normalizedValue,
          originalValue: value.originalValue,
          ...(value.unit ? { unit: value.unit } : {}),
          ...(value.currency ? { currency: value.currency } : {}),
          ...(value.period ? { period: value.period } : {}),
          ...(value.asOf ?? envelope.asOf ? { asOf: value.asOf ?? envelope.asOf } : {}),
        },
        freshness: {
          retrievedAt: envelope.retrievedAt,
          ...(envelope.asOf !== undefined ? { asOf: envelope.asOf } : {}),
          stale: envelope.stale,
        },
        availability: 'available',
        provenance: {
          runId: envelope.runId,
          toolCallId: envelope.toolCallId,
          toolName: envelope.toolName,
          ...(envelope.capabilityId ? { capabilityId: envelope.capabilityId } : {}),
          provider: envelope.provider,
        },
      });
    }
  }
  return { sources, evidence };
}

export interface EvidenceRefProjection extends FinancialEvidenceProjection {
  claims: EvidenceClaim[];
}

/**
 * Project Deep Research report / thesis evidence links. Each EvidenceRef
 * carries a claim statement plus the capability run that backs it; the
 * projection splits it into a claim and a tool_result evidence item. Claims
 * with the same statement (and instrument scope) share a claimId and merge
 * their evidence in the bundle.
 */
export function projectEvidenceRefs(refs: EvidenceRef[]): EvidenceRefProjection {
  const sources: EvidenceSource[] = [];
  const evidence: EvidenceItem[] = [];
  const claims: EvidenceClaim[] = [];
  for (const ref of refs) {
    const sourceId = deriveSourceId('tool', {
      publisher: ref.capabilityId,
      runId: ref.runId,
      instrumentId: ref.instrumentId,
    });
    sources.push({
      sourceId,
      kind: 'tool',
      publisher: ref.capabilityId,
      retrievedAt: ref.fetchedAt,
    });
    const evidenceId = deriveEvidenceId(sourceId, 'tool_result', [
      ref.summary ?? '',
      ref.claim,
    ], ref.fetchedAt);
    evidence.push({
      evidenceId,
      sourceId,
      kind: 'tool_result',
      ...(ref.summary ? { excerpt: { text: ref.summary } } : {}),
      freshness: { retrievedAt: ref.fetchedAt, stale: false },
      availability: 'available',
      provenance: {
        runId: ref.runId,
        capabilityId: ref.capabilityId,
        ...(ref.instrumentId ? { instrumentId: ref.instrumentId } : {}),
      },
    });
    claims.push({
      claimId: deriveClaimId(ref.claim, ref.instrumentId),
      statement: ref.claim,
      evidenceIds: [evidenceId],
      verification: 'unverified',
    });
  }
  return { sources, evidence, claims };
}

/** Project fetched news items into news sources with text excerpts. */
export function projectNewsItems(items: NewsItem[]): FinancialEvidenceProjection {
  const sources: EvidenceSource[] = [];
  const evidence: EvidenceItem[] = [];
  for (const item of items) {
    const sourceId = deriveSourceId('news', { url: item.url });
    sources.push({
      sourceId,
      kind: 'news',
      canonicalUrl: item.url,
      retrievedAt: item.timestamp,
      publishedAt: item.timestamp,
    });
    const text = item.summary || item.title;
    if (!text) continue;
    evidence.push({
      evidenceId: deriveEvidenceId(sourceId, 'text_excerpt', [text, 'summary'], item.timestamp),
      sourceId,
      kind: 'text_excerpt',
      excerpt: { text },
      freshness: { retrievedAt: item.timestamp, stale: false },
      availability: 'available',
      provenance: {
        ...(item.instrumentId ? { instrumentId: item.instrumentId } : {}),
      },
    });
  }
  return { sources, evidence };
}

export interface TextEvidenceInput {
  kind: Extract<EvidenceSourceKind, 'filing' | 'news' | 'web' | 'other'>;
  /** Canonical public URL, when the document has one. */
  url?: string;
  publisher?: string;
  text: string;
  /** Where the excerpt lives in the source, e.g. `paragraph.3`. */
  location?: string;
  retrievedAt: number;
  publishedAt?: number;
  /** Only set when actually known (e.g. exchange disclosure = regulator/primary). */
  authority?: { primary: boolean; sourceClass: EvidenceSourceClass };
  instrumentId?: string;
  runId?: string;
  provider?: string;
}

/**
 * Generic projection for document-shaped evidence (filings, web pages,
 * disclosures). Backs the filing projection path and future producers.
 * Array-shaped like the other projections, so it feeds buildEvidenceBundle
 * directly.
 */
export function projectTextEvidence(input: TextEvidenceInput): FinancialEvidenceProjection {
  const sourceId = deriveSourceId(input.kind, {
    publisher: input.publisher,
    url: input.url,
  });
  const source: EvidenceSource = {
    sourceId,
    kind: input.kind,
    ...(input.publisher ? { publisher: input.publisher } : {}),
    ...(input.url ? { canonicalUrl: input.url } : {}),
    retrievedAt: input.retrievedAt,
    ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
    ...(input.authority ? { authority: input.authority } : {}),
  };
  const evidence: EvidenceItem = {
    evidenceId: deriveEvidenceId(sourceId, 'text_excerpt', [input.text, input.location ?? ''], input.retrievedAt),
    sourceId,
    kind: 'text_excerpt',
    excerpt: { text: input.text, ...(input.location ? { location: input.location } : {}) },
    freshness: { retrievedAt: input.retrievedAt, stale: false },
    availability: 'available',
    provenance: {
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.instrumentId ? { instrumentId: input.instrumentId } : {}),
    },
  };
  return { sources: [source], evidence: [evidence] };
}

export interface EvidenceBundlePart {
  sources?: EvidenceSource[];
  evidence?: EvidenceItem[];
  claims?: EvidenceClaim[];
}

/**
 * Merge projections into one bundle: sources and evidence dedupe by id
 * (first seen wins, insertion order preserved); claims dedupe by claimId and
 * union their evidenceIds — the many-to-many claim ↔ evidence mapping.
 */
export function buildEvidenceBundle(...parts: EvidenceBundlePart[]): EvidenceBundle {
  const sources = new Map<string, EvidenceSource>();
  const evidence = new Map<string, EvidenceItem>();
  const claims = new Map<string, EvidenceClaim>();
  for (const part of parts) {
    for (const source of part.sources ?? []) {
      if (!sources.has(source.sourceId)) sources.set(source.sourceId, source);
    }
    for (const item of part.evidence ?? []) {
      if (!evidence.has(item.evidenceId)) evidence.set(item.evidenceId, item);
    }
    for (const claim of part.claims ?? []) {
      const existing = claims.get(claim.claimId);
      if (!existing) {
        claims.set(claim.claimId, { ...claim, evidenceIds: [...claim.evidenceIds] });
        continue;
      }
      const merged = [...existing.evidenceIds];
      for (const id of claim.evidenceIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      existing.evidenceIds = merged;
    }
  }
  return {
    schemaVersion: EVIDENCE_CONTRACT_SCHEMA_VERSION,
    sources: [...sources.values()],
    evidence: [...evidence.values()],
    claims: [...claims.values()],
  };
}

/** Runtime guard for bundles crossing persistence / IPC / import boundaries. */
export function isEvidenceBundle(value: unknown): value is EvidenceBundle {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === EVIDENCE_CONTRACT_SCHEMA_VERSION
    && Array.isArray(record.sources)
    && Array.isArray(record.evidence)
    && Array.isArray(record.claims);
}

/** Deterministic JSON serialization for audit / export / reload. */
export function serializeEvidenceBundle(bundle: EvidenceBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** Reload a serialized bundle; returns undefined on unknown or wrong-version payloads. */
export function parseEvidenceBundle(json: string): EvidenceBundle | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return isEvidenceBundle(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function deriveSourceId(
  kind: EvidenceSourceKind,
  origin: Record<string, unknown>
): string {
  return `src_${hashText(`${kind}|${stableJson(origin)}`).slice(0, 24)}`;
}

function deriveEvidenceId(
  sourceId: string,
  kind: EvidenceItem['kind'],
  content: string[],
  retrievedAt: number
): string {
  return `ev_${hashText([sourceId, kind, ...content, String(retrievedAt)].join('|')).slice(0, 24)}`;
}

function deriveClaimId(statement: string, instrumentId?: string): string {
  return `claim_${hashText([statement, instrumentId ?? ''].join('|')).slice(0, 24)}`;
}

/** Order-stable JSON serialization so identity hashes never depend on key order. */
function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

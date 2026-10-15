import { createHash } from 'node:crypto';
import type {
  CapabilityResult,
  NewsItem,
  SourceDriftStatus,
  SourceProvenanceSnapshot,
} from '@finagent/core';

const SCHEMA_VERSION = 'folio-source-provenance/v1' as const;

export interface SourceSnapshotInput {
  documentId?: string;
  canonicalUrl?: string;
  title?: string;
  author?: string;
  publishedAt?: number;
  retrievedAt: number;
  provider: string;
  method: string;
  /** The exact source span supplied to the report/evidence path. */
  excerpt: string;
  /**
   * The smallest source content from which `excerpt` was selected. It is
   * hashed but intentionally never persisted, so a report is auditable without
   * becoming a general web archive.
   */
  sourceContent?: string;
  sourceVersion?: string;
}

export interface LiveSourceObservation {
  available: boolean;
  canonicalUrl?: string;
  title?: string;
  author?: string;
  publishedAt?: number;
  excerpt?: string;
  sourceContent?: string;
  sourceVersion?: string;
}

export interface SourceDriftCheck {
  status: SourceDriftStatus;
  original: SourceProvenanceSnapshot;
  /** Present only when a current source was successfully retrieved. */
  current?: {
    canonicalUrl?: string;
    excerptHash: string;
    sourceContentHash: string;
    sourceVersion?: string;
  };
  reasons: Array<'content_changed' | 'version_changed' | 'canonical_url_changed' | 'unavailable'>;
}

/** A privacy-policy-aware live retrieval adapter, supplied by the caller. */
export type SourceSnapshotRefresher = (
  original: Readonly<SourceProvenanceSnapshot>
) => Promise<LiveSourceObservation>;

/**
 * Create the durable, minimum-necessary provenance record for one source.
 * `sourceId` excludes retrieval time; observations of the same source can
 * therefore be compared even after an application restart.
 */
export function createSourceProvenanceSnapshot(input: SourceSnapshotInput): SourceProvenanceSnapshot {
  const canonicalUrl = canonicalizeUrl(input.canonicalUrl);
  const documentId = cleanOptional(input.documentId);
  const title = cleanOptional(input.title);
  const author = cleanOptional(input.author);
  const provider = cleanRequired(input.provider, 'unknown');
  const method = cleanRequired(input.method, 'unknown');
  const excerpt = cleanText(input.excerpt);
  const sourceContent = cleanText(input.sourceContent ?? excerpt);
  const sourceIdentity = documentId
    ?? canonicalUrl
    ?? `${provider}:${title ?? hashText(excerpt)}`;

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceId: `src_${hashText(`${provider}:${sourceIdentity}`).slice(0, 24)}`,
    ...(documentId ? { documentId } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(validTimestamp(input.publishedAt) ? { publishedAt: input.publishedAt } : {}),
    retrievedAt: validTimestamp(input.retrievedAt) ? input.retrievedAt : 0,
    retrieval: { provider, method },
    excerpt,
    excerptHash: hashSourceText(excerpt),
    sourceContentHash: hashSourceText(sourceContent),
    ...(cleanOptional(input.sourceVersion) ? { sourceVersion: cleanOptional(input.sourceVersion) } : {}),
  };
}

/**
 * Snapshot every report evidence source without storing an entire page or raw
 * capability response. News keeps one snapshot per retrieved article; other
 * capability results retain the exact result summary that reached the report.
 */
export function snapshotCapabilityEvidence(input: {
  capabilityId: string;
  result: CapabilityResult<unknown>;
  retrievedAt: number;
}): SourceProvenanceSnapshot[] {
  const provider = cleanRequired(input.result.provenance.providerId ?? input.result.provenance.provider, 'unknown');
  if (input.capabilityId === 'research.news' && isNewsItems(input.result.data)) {
    const snapshots = input.result.data.map((item) => createSourceProvenanceSnapshot({
      documentId: item.id,
      canonicalUrl: item.url,
      title: item.title,
      publishedAt: toEpochMs(item.timestamp),
      retrievedAt: input.retrievedAt,
      provider,
      method: 'capability:research.news',
      excerpt: newsExcerpt(item),
      sourceContent: newsExcerpt(item),
    }));
    if (snapshots.length > 0) return snapshots;
  }

  const excerpt = cleanText(input.result.summary ?? `${input.capabilityId} completed.`);
  return [createSourceProvenanceSnapshot({
    documentId: `capability:${input.capabilityId}:${input.result.provenance.instrumentId ?? 'global'}`,
    title: input.capabilityId,
    retrievedAt: input.retrievedAt,
    provider,
    method: `capability:${input.capabilityId}`,
    excerpt,
    sourceContent: excerpt,
  })];
}

/** Compare a newly retrieved source against the immutable report snapshot. */
export function detectSourceDrift(
  original: SourceProvenanceSnapshot,
  live: LiveSourceObservation
): SourceDriftCheck {
  if (!live.available) {
    return { status: 'source_unavailable', original, reasons: ['unavailable'] };
  }

  const canonicalUrl = canonicalizeUrl(live.canonicalUrl);
  const excerpt = cleanText(live.excerpt ?? '');
  const sourceContent = cleanText(live.sourceContent ?? excerpt);
  const current = {
    ...(canonicalUrl ? { canonicalUrl } : {}),
    excerptHash: hashSourceText(excerpt),
    sourceContentHash: hashSourceText(sourceContent),
    ...(cleanOptional(live.sourceVersion) ? { sourceVersion: cleanOptional(live.sourceVersion) } : {}),
  };
  const reasons: SourceDriftCheck['reasons'] = [];
  if (current.sourceContentHash !== original.sourceContentHash) reasons.push('content_changed');
  if (original.sourceVersion && current.sourceVersion && original.sourceVersion !== current.sourceVersion) {
    reasons.push('version_changed');
  }
  if (original.canonicalUrl && current.canonicalUrl && original.canonicalUrl !== current.canonicalUrl) {
    reasons.push('canonical_url_changed');
  }
  return { status: reasons.length > 0 ? 'source_drifted' : 'current', original, current, reasons };
}

/**
 * Convert retrieval failures into an explicit unavailable state. Callers own
 * networking and privacy/redaction policy; this helper never fetches URLs.
 */
export async function refreshSourceSnapshot(
  original: SourceProvenanceSnapshot,
  refresh: SourceSnapshotRefresher
): Promise<SourceDriftCheck> {
  try {
    return detectSourceDrift(original, await refresh(original));
  } catch {
    return detectSourceDrift(original, { available: false });
  }
}

export function hashSourceText(value: string): string {
  return `sha256:${hashText(cleanText(value))}`;
}

function canonicalizeUrl(value: string | undefined): string | undefined {
  const candidate = cleanOptional(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return undefined;
  }
}

function newsExcerpt(item: NewsItem): string {
  return cleanText([item.title, item.summary].filter(Boolean).join('\n\n'));
}

function isNewsItems(value: unknown): value is NewsItem[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object'
    && typeof (item as NewsItem).id === 'string'
    && typeof (item as NewsItem).title === 'string'
    && typeof (item as NewsItem).summary === 'string'
    && typeof (item as NewsItem).url === 'string'
    && typeof (item as NewsItem).timestamp === 'number');
}

function toEpochMs(value: number): number | undefined {
  return Number.isFinite(value) ? value * 1000 : undefined;
}

function validTimestamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function cleanText(value: string): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value === undefined ? undefined : cleanText(value);
  return cleaned || undefined;
}

function cleanRequired(value: string | undefined, fallback: string): string {
  return cleanOptional(value) ?? fallback;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

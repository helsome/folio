// Unified inline citations (#30).
//
// Copilot answers reference evidence with explicit, self-describing markers
// embedded in the Markdown text: `⟦cite:<tool-call-id>⟧`. Markers are parsed
// at render time (streaming-safe: the marker carries its own id, so numbering
// never depends on position), rendered as clickable `[n]` superscripts, and
// resolved against the run's evidence records by the UI. Unknown or fabricated
// ids degrade to a muted, non-clickable marker — never invented provenance.

/** Current citation contract version. */
export const CITATION_SCHEMA_VERSION = 1;

/** Marker delimiters. Unlikely glyphs keep ordinary brackets/links intact. */
export const CITATION_MARKER_START = '⟦cite:';
export const CITATION_MARKER_END = '⟧';

/** Maximum accepted marker id length (envelope ids are 27 chars). */
export const CITATION_ID_MAX_LENGTH = 80;

const CITATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

/** Kinds of provenance a citation can point at. */
export type CitationSourceKind = 'financial' | 'news' | 'document' | 'tool';

/**
 * UI-facing projection of one citable origin. Assembled on the renderer side
 * from `Message.financialEvidence` and `Message.toolCalls` — nothing new is
 * persisted.
 *
 * Citation ids are tool-call ids: they exist at generation time in both
 * backends (local emitter and Pi tool results), are stable across streaming
 * and persistence, and join to the persisted `fe_*` evidence envelope via
 * `FinancialEvidenceEnvelope.toolCallId`.
 */
export interface CitationSource {
  /** Canonical citation id — the tool-call id. */
  id: string;
  /** Persisted evidence-envelope id (`fe_*`) when a financial envelope exists. */
  envelopeId?: string;
  kind: CitationSourceKind;
  toolName: string;
  provider?: string;
  /** One-line summary, e.g. `AAPL · lastPrice` or a news headline. */
  title?: string;
  url?: string;
  retrievedAt?: number;
  /** Epoch milliseconds — mirrors FinancialEvidenceValue.asOf. */
  asOf?: number;
  stale?: boolean;
  status: 'success' | 'error';
}

/** One resolved citation marker (numbering assigned at render time). */
export interface CitationMarker {
  /** Display number, 1-based, by first appearance within the message. */
  index: number;
  sourceId: string;
}

export type CitationSegment =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; sourceId: string; raw: string };

/** True when `value` is a well-formed citation id (charset/length only). */
export function isCitationSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CITATION_ID_MAX_LENGTH && CITATION_ID_PATTERN.test(value);
}

/**
 * Split answer text into plain-text and citation-marker segments. Only run
 * this on text segments — markers inside `folio-block` fences stay untouched
 * (block evidence is referenced via `evidenceIds`, not inline markers).
 */
export function parseCitationSegments(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  const pattern = new RegExp(`${CITATION_MARKER_START}([^⟦⟧]+?)${CITATION_MARKER_END}`, 'g');
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const sourceId = match[1];
    if (match.index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    segments.push(isCitationSourceId(sourceId)
      ? { kind: 'citation', sourceId, raw }
      : { kind: 'text', text: raw });
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

/**
 * Assign stable display numbers by first appearance. Ids that never appear in
 * the text (block-only evidence) are appended after the inline ones so block
 * chips and inline markers share one numbering space.
 */
export function buildCitationNumbering(inlineOrder: string[], blockOnlyIds: string[] = []): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const id of inlineOrder) {
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  }
  for (const id of blockOnlyIds) {
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  }
  return numbers;
}

/** Render a marker back into answer text (used by deterministic emitters). */
export function renderCitationMarker(sourceId: string): string {
  return `${CITATION_MARKER_START}${sourceId}${CITATION_MARKER_END}`;
}

/**
 * Passage-level evidence location — where a piece of evidence actually sits
 * inside the source it was retrieved from.
 *
 * Issue #13 asks for evidence that points at a concrete passage/span instead of
 * a bare URL or a document-level reference. A `SourcePassage` keeps the minimum
 * needed to restore that position later: source/document identity, the verbatim
 * excerpt, and location metadata describing where the excerpt was found in the
 * retrieved text.
 *
 * Two deliberate constraints:
 *
 * - The excerpt is verbatim source text. It is never synthesized, summarized or
 *   re-worded by Folio, and a verifier's explanation can never become one.
 * - The location is metadata about a past retrieval, not a promise about the
 *   present. Re-deriving it against a freshly retrieved document may legitimately
 *   fail (the source changed); callers must treat that as "unresolvable", never
 *   as a reason to guess a nearby offset.
 */

/**
 * Where a passage sits inside the source text it was located in.
 *
 * Offsets are 0-based character offsets into the exact text that was searched,
 * so `sourceText.slice(start, end)` is the excerpt itself. `line` / `column` are
 * 1-based and are what a reader-facing jump needs in order to scroll a document.
 */
export interface PassageLocation {
  /** 0-based offset of the first character of the excerpt. */
  start: number;
  /** Exclusive end offset. `sourceText.slice(start, end)` equals the excerpt. */
  end: number;
  /** 1-based line number of `start`. */
  line: number;
  /** 1-based column of `start` within its line. */
  column: number;
}

/**
 * One locatable span of a source document, together with the evidence-producing
 * run it came from.
 *
 * A passage is deliberately not a claim: it records "this text exists at this
 * position in this source". Which claims rest on it is decided elsewhere, which
 * is what keeps one source able to support several claims.
 */
export interface SourcePassage {
  /**
   * Stable id inside the report. Derived from the run, the capability, the
   * source document identity and the span — never from array position — so it
   * survives report assembly, persistence, reload and export unchanged.
   */
  id: string;
  /** `CapabilityRunRecord.id` of the run whose result this source came from. */
  runId: string;
  /** Capability that retrieved the source, e.g. `research.news`. */
  capabilityId: string;
  /** Provider document identity within the run, e.g. `NewsItem.id`, when known. */
  documentId?: string;
  /** Canonical public URL of the source document, when it has one. */
  canonicalUrl?: string;
  /** Verbatim excerpt taken from the source. Never synthesized. */
  excerpt: string;
  /** Where `excerpt` sits inside the retrieved source text. */
  location: PassageLocation;
}

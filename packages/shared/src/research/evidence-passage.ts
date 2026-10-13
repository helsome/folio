import type {
  CapabilityResult,
  NewsItem,
  PassageLocation,
  SourcePassage,
} from '@finagent/core';

/**
 * Passage-level evidence location for Deep Research reports (issue #13, step 2).
 *
 * The report already records *which run* produced a piece of evidence. What it
 * could not record was *where inside the source* the supporting text actually
 * is — so a reader jumping from a claim landed on a source homepage rather than
 * the passage. This module derives that position at assembly time and can
 * re-derive it after a reload, which is what keeps a claim → passage jump valid
 * across persistence.
 *
 * Everything here is a pure function over data the report already carries, so a
 * rebuilt report yields byte-identical passages: no clock, no filesystem, no
 * second source of truth.
 */

/** How many whitespace-separated words an excerpt may span before we give up. */
const MAX_EXCERPT_WORDS = 400;

/**
 * Locate `excerpt` inside `sourceText` and return its exact position.
 *
 * Matching is whitespace-tolerant in one direction only: runs of whitespace in
 * the excerpt may match runs of whitespace in the source, so an excerpt lifted
 * from a re-wrapped document still resolves. Every other character must match
 * exactly — the excerpt is verbatim source text, and a "close enough" match is
 * precisely the fabricated citation this feature exists to prevent.
 *
 * Returns `undefined` when the excerpt is empty, too long to be a passage, or
 * simply absent. Callers must treat `undefined` as "unresolvable" and surface
 * that, never substitute a nearby offset.
 *
 * @param options.occurrence 1-based index of the match to return. Defaults to 1;
 *   out-of-range values resolve to `undefined` rather than clamping.
 */
export function locatePassage(
  sourceText: string,
  excerpt: string,
  options?: { occurrence?: number },
): PassageLocation | undefined {
  if (typeof sourceText !== 'string' || sourceText.length === 0) return undefined;
  if (typeof excerpt !== 'string') return undefined;

  const trimmed = excerpt.trim();
  if (trimmed.length === 0) return undefined;

  const words = trimmed.split(/\s+/);
  if (words.length > MAX_EXCERPT_WORDS) return undefined;

  const occurrence = options?.occurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1) return undefined;

  // `\s+` between escaped words keeps offsets in the ORIGINAL source text, so
  // `sourceText.slice(start, end)` stays a faithful excerpt even when the
  // matched run of whitespace is longer than the one in the excerpt.
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'gu');
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = pattern.exec(sourceText)) !== null) {
    seen += 1;
    if (seen === occurrence) {
      const start = match.index;
      const end = start + match[0].length;
      return { start, end, ...lineColumnAt(sourceText, start) };
    }
  }
  return undefined;
}

/**
 * Re-derive a persisted passage's location against the source text available
 * now. Returns `undefined` when the excerpt no longer appears, which is the
 * honest answer when a source has changed or been taken down.
 *
 * The passage's own `location` is never used as a fallback: stale offsets that
 * happen to still be in range would highlight unrelated text.
 */
export function relocatePassage(
  passage: Pick<SourcePassage, 'excerpt'>,
  sourceText: string,
  options?: { occurrence?: number },
): PassageLocation | undefined {
  return locatePassage(sourceText, passage.excerpt, options);
}

export interface BuildPassagesInput {
  /** `CapabilityRunRecord.id` of the run that produced `result`. */
  runId: string;
  /** Capability id, e.g. `research.news`. */
  capabilityId: string;
  result: CapabilityResult<unknown>;
}

/**
 * Derive locatable passages from one capability result.
 *
 * Only sources that carry their own retrievable text can be located, so this
 * returns `[]` for structured-data capabilities rather than inventing a span
 * out of a generated summary — a `CapabilityResult.summary` is Folio's prose,
 * not the source's, and locating it would manufacture provenance.
 */
export function buildCapabilityPassages(input: BuildPassagesInput): SourcePassage[] {
  if (input.capabilityId !== 'research.news') return [];
  if (!isNewsItems(input.result.data)) return [];

  const passages: SourcePassage[] = [];
  input.result.data.forEach((item, index) => {
    const sourceText = newsSourceText(item);
    if (sourceText.length === 0) return;

    const excerpt = newsExcerpt(item);
    const location = locatePassage(sourceText, excerpt);
    if (location === undefined) return;

    passages.push({
      id: passageIdOf({
        runId: input.runId,
        capabilityId: input.capabilityId,
        documentId: item.id,
        position: index,
        location,
      }),
      runId: input.runId,
      capabilityId: input.capabilityId,
      ...(item.id ? { documentId: item.id } : {}),
      ...(item.url ? { canonicalUrl: item.url } : {}),
      excerpt,
      location,
    });
  });
  return passages;
}

/** Passages a piece of evidence resolves to — the evidence → passage direction. */
export function passagesForEvidence(
  passages: readonly SourcePassage[],
  evidence: { runId: string; capabilityId: string },
): SourcePassage[] {
  return passages.filter(
    (passage) =>
      passage.runId === evidence.runId && passage.capabilityId === evidence.capabilityId,
  );
}

/**
 * Deterministic passage id. `position` is only a tiebreaker for sources with no
 * provider document identity (and for duplicate ids), so reordering two news
 * items that both have ids never renames an existing passage.
 */
export function passageIdOf(input: {
  runId: string;
  capabilityId: string;
  documentId?: string;
  position: number;
  location: PassageLocation;
}): string {
  const document = input.documentId && input.documentId.length > 0
    ? input.documentId
    : `#${input.position}`;
  return `passage:${input.runId}:${input.capabilityId}:${document}:${input.location.start}-${input.location.end}`;
}

/** The exact text a news item was retrieved as. Used only to locate offsets. */
function newsSourceText(item: NewsItem): string {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (title.length === 0) return summary;
  return summary.length === 0 ? title : `${title}\n\n${summary}`;
}

/**
 * The excerpt a news item contributes. The summary is the substantive retrieved
 * text, so it is preferred; a summary-less item falls back to its headline.
 */
function newsExcerpt(item: NewsItem): string {
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (summary.length > 0) return summary;
  return typeof item.title === 'string' ? item.title.trim() : '';
}

function isNewsItems(data: unknown): data is NewsItem[] {
  return Array.isArray(data) && data.every(
    (item) => item !== null && typeof item === 'object'
      && typeof (item as NewsItem).title === 'string'
      && typeof (item as NewsItem).summary === 'string',
  );
}

function lineColumnAt(sourceText: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (sourceText.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

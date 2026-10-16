/**
 * Split a — possibly partial — Markdown document into render-stable blocks.
 *
 * A Copilot stream appends tokens, so re-parsing the whole document on every
 * animation frame is O(n) per frame and O(n²) per answer (#28). Rendering
 * block-by-block lets the renderer memoize every block before the one that is
 * still arriving, so a token burst only re-parses the tail.
 *
 * Splitting is deliberately conservative: a boundary is only taken at a blank
 * line whose following line cannot continue the block above it. Anything that
 * could change meaning when separated — an open fence, a loose list, a
 * multi-line blockquote, a document-scoped link reference, a raw-HTML block —
 * is kept whole (or the whole document is returned as one block), at the cost
 * of a larger tail. The renderer falls back to whole-document rendering once
 * the stream completes, so the final DOM never depends on these heuristics.
 */

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
// A thematic break must be tested before the list marker: "- - -" and "* * *"
// are breaks, not list items (CommonMark gives the break precedence).
const THEMATIC_BREAK = /^[ \t]{0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const LIST_MARKER = /^[ \t]{0,3}([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLOCKQUOTE_LINE = /^[ \t]{0,3}>/;
const ATX_HEADING = /^[ \t]{0,3}#{1,6}([ \t]|$)/;
const LINK_REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:/;
// A line that opens a raw-HTML block (`<script>`, `<pre>`, `<!--`, …). Some
// HTML block types run across blank lines until their closing tag, so a
// blank-line boundary inside them would change what the renderer shows.
const HTML_BLOCK_LINE = /^[ \t]{0,3}<[a-zA-Z!/?]/;
const BLANK_LINE = /^[ \t]*\r?$/;
const INDENTED_CONTINUATION = /^[ \t]+\S/;

// `split('\n')` leaves the carriage return on CRLF lines. Strip it only for
// delimiter detection so the original Markdown bytes reach the renderer
// unchanged — the same rule parseAnswerSegments follows.
const withoutCarriageReturn = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

/**
 * Split `content` into blocks separated by blank lines. Blocks are returned in
 * document order; joining them with a blank line reproduces the document's
 * block structure (runs of blank lines collapse to one, which is semantically
 * identical in Markdown).
 */
export function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split('\n');

  // Link reference definitions are document-scoped: `[text][ref]` resolves
  // against a definition that may live anywhere in the document, so a split
  // could silently turn a reference into literal text. Fall back to one
  // whole-document block whenever the document uses them.
  if (lines.some((line) => LINK_REFERENCE_DEFINITION.test(withoutCarriageReturn(line)))) {
    return [content];
  }

  // Raw HTML blocks (script/pre/style/textarea, comments) may span blank
  // lines until their closing tag; splitting inside one would render content
  // the whole-document parse keeps inside the inert HTML node. Agent output
  // is data, so raw HTML is not something we want to encourage anyway —
  // falling back to one block trades streaming incrementality for exact
  // semantics in documents that contain it.
  if (lines.some((line) => HTML_BLOCK_LINE.test(withoutCarriageReturn(line)))) {
    return [content];
  }

  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { marker: string } | null = null;
  let inList = false;
  let inBlockquote = false;

  const flush = (): void => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const bare = withoutCarriageReturn(line);

    // Inside a fence everything is literal until a closing fence of the same
    // marker and at least the opening length arrives — blank lines included.
    if (fence) {
      current.push(line);
      const close = bare.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence.marker[0] && close.length >= fence.marker.length) {
        fence = null;
      }
      continue;
    }

    if (BLANK_LINE.test(bare)) {
      // A blank line only ends a block when the next non-blank line starts a
      // new one; look ahead before committing to the boundary.
      let next = index + 1;
      while (next < lines.length && BLANK_LINE.test(withoutCarriageReturn(lines[next] ?? ''))) {
        next += 1;
      }
      if (next >= lines.length) {
        // Trailing blank lines render as nothing; drop them instead of
        // emitting an empty trailing block.
        break;
      }
      const nextBare = withoutCarriageReturn(lines[next] ?? '');
      // "- - -" would match the list marker but is a thematic break, which
      // ends the list — test the break first.
      const continuesList =
        inList &&
        !THEMATIC_BREAK.test(nextBare) &&
        (LIST_MARKER.test(nextBare) || INDENTED_CONTINUATION.test(nextBare));
      const continuesBlockquote = inBlockquote && BLOCKQUOTE_LINE.test(nextBare);
      if (continuesList || continuesBlockquote) {
        // Keep the blank line inside the block: loose lists and multi-line
        // blockquotes are one construct even across a blank line.
        current.push(line);
      } else {
        flush();
        inList = false;
        inBlockquote = false;
      }
      continue;
    }

    const open = bare.match(FENCE_OPEN);
    const openMarker = open?.[1];
    const openInfo = open?.[2] ?? '';
    // Backtick info strings cannot contain another backtick — such a line is
    // prose, not a fence, and must not swallow the rest of the document.
    if (openMarker && !(openMarker[0] === '`' && openInfo.includes('`'))) {
      current.push(line);
      fence = { marker: openMarker };
      // An unindented fence interrupts a list or blockquote it sits inside.
      if (!/^[ \t]/.test(bare)) {
        inList = false;
        inBlockquote = false;
      }
      continue;
    }

    if (THEMATIC_BREAK.test(bare)) {
      current.push(line);
      inList = false;
      inBlockquote = false;
      continue;
    }

    if (LIST_MARKER.test(bare)) {
      current.push(line);
      inList = true;
      continue;
    }

    if (BLOCKQUOTE_LINE.test(bare)) {
      current.push(line);
      inBlockquote = true;
      continue;
    }

    if (ATX_HEADING.test(bare)) {
      // A heading interrupts a list or blockquote it sits inside.
      current.push(line);
      inList = false;
      inBlockquote = false;
      continue;
    }

    // Paragraph text, table rows, indented code, inline HTML, … — appended to
    // the block being built. A lazy continuation line keeps the current context.
    current.push(line);
  }

  flush();
  return blocks;
}

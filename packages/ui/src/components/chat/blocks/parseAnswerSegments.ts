import { ANSWER_BLOCK_FENCE_LANG } from '@finagent/core';

/**
 * One segment of a Copilot answer: either Markdown text or a typed
 * `folio-block` fence body. Untyped fences stay in text segments so ordinary
 * code blocks keep rendering through Markdown.
 */
export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'block'; body: string; closed: boolean };

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;

// `split('\n')` leaves the carriage return on CRLF lines. Strip it only for
// delimiter detection so the ordinary Markdown and typed JSON bytes remain
// unchanged in the returned segments.
const fenceLine = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

/**
 * Split an answer string into text and typed-block segments.
 *
 * Every fence is opaque until a bare closing fence with the same marker and
 * at least the opening length arrives. This keeps `folio-block` examples
 * inside ordinary Markdown code fences as literal text.
 *
 * An unclosed `folio-block` fence produces a `closed: false` block segment for
 * streaming; unclosed ordinary fences remain verbatim Markdown.
 */
export function parseAnswerSegments(content: string): AnswerSegment[] {
  const lines = content.split('\n');
  const segments: AnswerSegment[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      segments.push({ kind: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const open = fenceLine(line).match(FENCE_OPEN);
    const marker = open?.[1];
    const info = open?.[2] ?? '';

    // Backtick info strings cannot contain another backtick. Such a line is
    // prose rather than a fence and must not swallow later answer blocks.
    if (!marker || (marker[0] === '`' && info.includes('`'))) {
      textLines.push(line);
      index += 1;
      continue;
    }

    const typed = info.trim() === ANSWER_BLOCK_FENCE_LANG;
    if (typed) flushText();
    else textLines.push(line);

    const bodyLines: string[] = [];
    let closed = false;
    index += 1;
    while (index < lines.length) {
      const bodyLine = lines[index] ?? '';
      const close = fenceLine(bodyLine).match(FENCE_CLOSE)?.[1];
      if (close && close[0] === marker[0] && close.length >= marker.length) {
        if (!typed) textLines.push(bodyLine);
        closed = true;
        index += 1;
        break;
      }
      if (typed) bodyLines.push(bodyLine);
      else textLines.push(bodyLine);
      index += 1;
    }
    if (typed) segments.push({ kind: 'block', body: bodyLines.join('\n'), closed });
  }
  flushText();
  return segments;
}

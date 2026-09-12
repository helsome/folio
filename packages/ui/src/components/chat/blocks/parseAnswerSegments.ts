import { ANSWER_BLOCK_FENCE_LANG } from '@finagent/core';

/**
 * One segment of a Copilot answer: either Markdown text or a typed
 * `folio-block` fence body. Untyped fences stay in text segments so ordinary
 * code blocks keep rendering through Markdown.
 */
export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'block'; body: string; closed: boolean };

const FENCE_OPEN = /^[ \t]{0,3}```(.*)$/;
const FENCE_CLOSE = /^[ \t]{0,3}```[ \t]*$/;

/**
 * Split an answer string into text and typed-block segments.
 *
 * A `folio-block` fence that has not been closed yet (streaming) produces a
 * `closed: false` block segment holding the partial body — everything after an
 * unclosed fence belongs to it, mirroring how Markdown itself treats an
 * unclosed fence. All other fences remain plain text.
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
    const open = line.match(FENCE_OPEN);
    if (open && open[1].trim() === ANSWER_BLOCK_FENCE_LANG) {
      flushText();
      const bodyLines: string[] = [];
      let closed = false;
      index += 1;
      while (index < lines.length) {
        const bodyLine = lines[index] ?? '';
        if (FENCE_CLOSE.test(bodyLine)) {
          closed = true;
          index += 1;
          break;
        }
        bodyLines.push(bodyLine);
        index += 1;
      }
      segments.push({ kind: 'block', body: bodyLines.join('\n'), closed });
      continue;
    }
    textLines.push(line);
    index += 1;
  }
  flushText();
  return segments;
}

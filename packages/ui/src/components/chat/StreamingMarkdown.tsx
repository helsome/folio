import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from './MarkdownContent';

/**
 * ============================================================================
 * Streaming Markdown hardening (issue #28)
 * ----------------------------------------------------------------------------
 * `StreamingMarkdown` renders agent-authored Markdown that arrives token by
 * token. It is layered on top of the existing static renderer
 * (`MarkdownContent` + `markdownComponents`) rather than rewriting it, so the
 * visual language stays in exactly one place. The hardening it adds:
 *
 *   1. **Frozen prefix.** Completed blocks are parsed once and never rebuilt, so
 *      the work per delta is proportional to the still-growing tail rather than
 *      the whole answer. Re-parsing the full document on every token is what
 *      makes naive streaming O(n^2) and causes flicker / layout thrash.
 *   2. **Lenient tail.** An unfinished fenced code block, table, list,
 *      blockquote, emphasis, link, entity or math span is still handled by the
 *      same remark pipeline, so a partial delta never crashes the message tree
 *      and complex blocks upgrade smoothly when their closing tokens land.
 *   3. **Static-equivalent completion.** When the stream ends the DOM matches a
 *      single static render of the same string; the equivalence tests assert
 *      this so it can never silently regress.
 *   4. **URL allow-list + redaction.** Link/image targets are validated against
 *      a strict scheme allow-list (defense in depth on top of the permanently
 *      disabled raw-HTML pipeline), and canary-shaped secrets are redacted
 *      before they can reach the DOM.
 * ============================================================================
 */

/** The only URL schemes that may reach the DOM. */
const ALLOWED_URL_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:'];

/**
 * Conservative patterns for canary-shaped secrets. Rendering-time redaction is
 * a last line of defense that complements the centralized redaction tracked in
 * #19 — a credential should never become visible even if one leaks into a model
 * answer.
 */
const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; to: string }> = [
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, to: '[redacted]' },
  { re: /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, to: 'Bearer [redacted]' },
  { re: /\bAuthorization\s*[:=]\s*[^\s,;]+/gi, to: 'Authorization: [redacted]' },
];

/**
 * Neutralize a Markdown link / image target.
 *
 * - `http:` / `https:` / `mailto:` pass through untouched (authored case kept).
 * - in-page `#anchor` links pass through;
 * - everything else — `javascript:`, `data:`, `blob:`, `file:`, `vbscript:`,
 *   protocol-relative `//host`, bare relative paths — collapses to `#`, so the
 *   element stays keyboard-focusable but cannot navigate or exfiltrate.
 *
 * ASCII control characters / whitespace inside the scheme are stripped first so
 * `java&#9;script:` and friends cannot smuggle a blocked scheme past the check.
 */
export function sanitizeUrl(raw?: string | null): string {
  if (raw == null) return '';
  const value = String(raw).trim();
  if (value === '') return '';

  const collapsed = value.replace(/[\u0000-\u0020\u007f]+/g, '');
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(collapsed);

  if (!schemeMatch) {
    // No scheme: allow in-page anchors, neutralize relative/external refs.
    return collapsed.startsWith('#') ? value : '#';
  }

  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  return ALLOWED_URL_SCHEMES.includes(scheme) ? value : '#';
}

/** Redact canary-shaped secrets before they can reach the DOM. */
export function redactSecrets(text: string): string {
  let output = text;
  for (const { re, to } of SECRET_PATTERNS) {
    output = output.replace(re, to);
  }
  return output;
}

/**
 * Split streamed Markdown into a frozen `stable` prefix and the still-growing
 * `tail`, cutting at the last blank-line block boundary that is **not** inside a
 * fenced code block.
 *
 * Blank lines terminate every CommonMark block (paragraph, list, table,
 * blockquote), so `stable` and `tail` are each valid documents and their
 * concatenation renders like the original. Because the boundary is recomputed
 * from the same string on every delta, `stable` only ever grows — which is
 * exactly what makes `React.memo` on the frozen prefix effective.
 */
const LIST_ITEM_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/;

function isListItem(line: string | undefined): boolean {
  return line !== undefined && LIST_ITEM_RE.test(line);
}

function previousNonBlank(lines: string[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor].trim() !== '') return lines[cursor];
  }
  return undefined;
}

function nextNonBlank(lines: string[], index: number): string | undefined {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].trim() !== '') return lines[cursor];
  }
  return undefined;
}

/**
 * Split streamed Markdown into a frozen `stable` prefix and the still-growing
 * `tail`, cutting at the last blank-line block boundary that is **not** inside a
 * fenced code block.
 *
 * Blank lines terminate every CommonMark block (paragraph, list, table,
 * blockquote), so `stable` and `tail` are each valid documents and their
 * concatenation renders like the original. Two refinements keep the split
 * semantically lossless:
 *
 * - a blank line that merely separates two items of one *loose list* is skipped,
 *   otherwise one list would render as two;
 * - the frozen prefix is trimmed of trailing newlines (moved into the tail), so
 *   the memoized string does not flap when a blank line completes and the next
 *   line begins — `stable` therefore only ever grows.
 */
export function splitStableTail(content: string): { stable: string; tail: string } {
  const lines = content.split('\n');
  let inFence = false;
  let boundaryLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() !== '') continue;
    if (isListItem(previousNonBlank(lines, index)) && isListItem(nextNonBlank(lines, index))) {
      continue;
    }
    boundaryLine = index + 1;
  }

  if (boundaryLine <= 0) return { stable: '', tail: content };

  const rawStable = lines.slice(0, boundaryLine).join('\n');
  const stable = rawStable.replace(/\n+$/, '');
  const tail = `${rawStable.slice(stable.length)}${lines.slice(boundaryLine).join('\n')}`;
  return { stable, tail };
}

/**
 * Frozen prefix renderer. `React.memo` (string prop equality) means completed
 * blocks are parsed exactly once and never rebuilt as the tail grows.
 */
const FrozenMarkdown = memo(function FrozenMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      urlTransform={sanitizeUrl}
    >
      {content}
    </ReactMarkdown>
  );
});

export interface StreamingMarkdownProps {
  content: string;
  className?: string;
  /**
   * `true` while tokens are still arriving — enables the frozen-prefix split.
   * `false` renders the whole string in one pass so the final DOM is the exact
   * static render of the same content.
   */
  streaming?: boolean;
}

export const StreamingMarkdown: React.FC<StreamingMarkdownProps> = ({
  content,
  className = '',
  streaming = false,
}) => {
  const safeContent = redactSecrets(content);
  const { stable, tail } = streaming
    ? splitStableTail(safeContent)
    : { stable: '', tail: safeContent };

  return (
    <div className={`markdown-content break-words text-[14px] leading-relaxed ${className}`}>
      {stable ? <FrozenMarkdown content={stable} /> : null}
      {/*
        A single parse emits exactly one "\n" text node between top-level block
        elements. Splitting into two parses drops that node at the seam, so we
        re-insert it — keeping the streamed DOM byte-identical to the static
        render of the same content.
      */}
      {stable !== '' && tail.trim() !== '' ? '\n' : null}
      {tail !== '' ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          urlTransform={sanitizeUrl}
        >
          {tail}
        </ReactMarkdown>
      ) : null}
    </div>
  );
};

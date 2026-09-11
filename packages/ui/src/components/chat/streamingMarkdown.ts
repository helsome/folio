export const STREAMING_MARKDOWN_CHUNK_SIZE = 2_048;

export interface StreamingMarkdownSnapshot {
  source: string;
  chunks: string[];
  tail: string;
}

export const EMPTY_STREAMING_MARKDOWN: StreamingMarkdownSnapshot = {
  source: '',
  chunks: [],
  tail: '',
};

/**
 * Incrementally partitions an append-only Markdown stream. Completed chunks
 * are immutable, allowing React to retain their already-rendered trees while
 * only the active tail is reparsed for subsequent deltas.
 */
export function updateStreamingMarkdown(
  previous: StreamingMarkdownSnapshot,
  content: string,
  chunkSize = STREAMING_MARKDOWN_CHUNK_SIZE,
): StreamingMarkdownSnapshot {
  if (!content.startsWith(previous.source)) {
    return partitionFromScratch(content, chunkSize);
  }

  let tail = previous.tail + content.slice(previous.source.length);
  const chunks = previous.chunks.slice();
  let boundary = findSafeBoundary(tail, chunkSize);

  while (boundary > 0) {
    chunks.push(tail.slice(0, boundary));
    tail = tail.slice(boundary);
    boundary = findSafeBoundary(tail, chunkSize);
  }

  return { source: content, chunks, tail };
}

function partitionFromScratch(content: string, chunkSize: number): StreamingMarkdownSnapshot {
  return updateStreamingMarkdown(EMPTY_STREAMING_MARKDOWN, content, chunkSize);
}

/** Find a paragraph boundary outside an open fenced-code block. */
function findSafeBoundary(markdown: string, minimum: number): number {
  let fence: { marker: '`' | '~'; length: number } | undefined;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf('\n', lineStart);
    if (newline < 0) break;

    const line = markdown.slice(lineStart, newline);
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: run.length };
      } else if (fence.marker === marker && run.length >= fence.length) {
        fence = undefined;
      }
    }

    const boundary = newline + 1;
    if (!fence && boundary >= minimum && markdown[newline + 1] === '\n') {
      return boundary + 1;
    }
    lineStart = boundary;
  }

  return 0;
}


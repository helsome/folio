import { describe, expect, it } from 'bun:test';
import { EMPTY_STREAMING_MARKDOWN, updateStreamingMarkdown } from './streamingMarkdown';

describe('updateStreamingMarkdown', () => {
  it('never freezes an incomplete fenced code block', () => {
    const open = 'Intro\n\n```ts\n' + 'const value = 1;\n'.repeat(20);
    const pending = updateStreamingMarkdown(EMPTY_STREAMING_MARKDOWN, open, 32);

    expect(pending.chunks).toEqual([]);
    expect(pending.tail).toContain('Intro');
    expect(pending.tail).toContain('```ts');

    const closed = updateStreamingMarkdown(pending, `${open}\`\`\`\n\nAfter\n\n`, 32);
    expect(closed.chunks.join('') + closed.tail).toBe(`${open}\`\`\`\n\nAfter\n\n`);
    expect(closed.chunks.join('')).toContain('const value = 1;');
  });

  it('keeps reparsed tail size bounded for a long append-only report', () => {
    const sections = Array.from(
      { length: 200 },
      (_, index) => `## Section ${index}\n\n| Metric | Value |\n| --- | ---: |\n| Revenue | ${index} |\n\nNarrative ${'x'.repeat(80)}.\n\n`,
    );
    let snapshot = EMPTY_STREAMING_MARKDOWN;
    let source = '';
    let largestTail = 0;

    for (const section of sections) {
      source += section;
      snapshot = updateStreamingMarkdown(snapshot, source, 256);
      largestTail = Math.max(largestTail, snapshot.tail.length);
    }

    expect(snapshot.chunks.length).toBeGreaterThan(50);
    expect(largestTail).toBeLessThan(512);
    expect(snapshot.chunks.join('') + snapshot.tail).toBe(source);
  });

  it('resets cleanly when a stream is replaced instead of appended', () => {
    const first = updateStreamingMarkdown(EMPTY_STREAMING_MARKDOWN, `${'a'.repeat(80)}\n\n`, 32);
    const replacement = updateStreamingMarkdown(first, '# New answer', 32);

    expect(replacement.chunks).toEqual([]);
    expect(replacement.tail).toBe('# New answer');
  });
});

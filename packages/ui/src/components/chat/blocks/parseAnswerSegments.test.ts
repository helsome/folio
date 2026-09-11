import { describe, expect, it } from 'bun:test';
import { parseAnswerSegments } from './parseAnswerSegments.ts';

describe('parseAnswerSegments', () => {
  it('keeps plain Markdown as a single text segment', () => {
    const content = '## Header\n\nSome **text**.\n';
    expect(parseAnswerSegments(content)).toEqual([{ kind: 'text', text: content }]);
  });

  it('splits text and a closed folio-block fence, preserving order', () => {
    const content = [
      'Intro paragraph.',
      '',
      '```folio-block',
      '{"version":1,"type":"metric_grid","metrics":[]}',
      '```',
      '',
      'Outro paragraph.',
    ].join('\n');
    const segments = parseAnswerSegments(content);
    expect(segments).toHaveLength(3);
    expect(segments[0].kind).toBe('text');
    expect(segments[1]).toEqual({
      kind: 'block',
      body: '{"version":1,"type":"metric_grid","metrics":[]}',
      closed: true,
    });
    expect(segments[2].kind).toBe('text');
  });

  it('treats an unclosed folio-block fence as a streaming block at the end', () => {
    const content = 'Before\n\n```folio-block\n{"partial":';
    const segments = parseAnswerSegments(content);
    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ kind: 'block', body: '{"partial":', closed: false });
  });

  it('leaves ordinary code fences inside text segments', () => {
    const content = '```json\n{"ok":true}\n```\n\ntext';
    const segments = parseAnswerSegments(content);
    expect(segments).toEqual([{ kind: 'text', text: content }]);
  });

  it('closes the block only at a bare fence line, not inline text', () => {
    const content = [
      '```folio-block',
      '{"a":1}',
      'the closing fence is mentioned as ``` inside prose',
      '```',
    ].join('\n');
    const segments = parseAnswerSegments(content);
    expect(segments).toEqual([
      { kind: 'block', body: ['{"a":1}', 'the closing fence is mentioned as ``` inside prose'].join('\n'), closed: true },
    ]);
  });

  it('handles multiple blocks between text', () => {
    const content = [
      'a',
      '```folio-block',
      '1',
      '```',
      'b',
      '```folio-block',
      '2',
      '```',
      'c',
    ].join('\n');
    const segments = parseAnswerSegments(content);
    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'block', 'text', 'block', 'text']);
  });
});

import { describe, expect, it } from 'bun:test';
import { parseAnswerSegments } from './parseAnswerSegments.ts';

const block = (body: string, closed = true) => ({ kind: 'block' as const, body, closed });
const text = (value: string) => ({ kind: 'text' as const, text: value });

describe('parseAnswerSegments fence boundaries', () => {
  it('does not activate a typed example inside a backtick code fence', () => {
    const content = ['```json', '```folio-block', '{"metrics":[]}', '```', '```', 'After'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([text(content)]);
  });

  it('does not activate a typed example inside a tilde code fence', () => {
    const content = ['~~~markdown', '~~~folio-block', '{"metrics":[]}', '~~~', '~~~', 'After'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([text(content)]);
  });

  it('requires a closing fence with the same marker and at least the opening length', () => {
    const content = [
      '````folio-block',
      '{"ok":true}',
      '```',
      '~~~',
      '````',
      'After',
    ].join('\n');

    expect(parseAnswerSegments(content)).toEqual([block(['{"ok":true}', '```', '~~~'].join('\n')), text('After')]);
  });

  it('accepts a longer matching closing fence', () => {
    const content = ['```folio-block', '{"ok":true}', '````', 'After'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([block('{"ok":true}'), text('After')]);
  });

  it('supports CRLF delimiters without losing body or following text', () => {
    const content = 'Before\r\n```folio-block\r\n{"ok":true}\r\n```\r\nAfter';

    expect(parseAnswerSegments(content)).toEqual([text('Before\r'), block('{"ok":true}\r'), text('After')]);
  });

  it('accepts up to three spaces but not four before a fence', () => {
    const content = ['   ```folio-block', '{"three":true}', '   ```', '    ```folio-block', '{"four":true}', '    ```'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([
      block('{"three":true}'),
      text('    ```folio-block\n{"four":true}\n    ```'),
    ]);
  });

  it('keeps an unclosed ordinary fence opaque while preserving a later typed fence', () => {
    const content = ['```ts', 'const example = true;', '```folio-block', '{"not":"live"}'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([text(content)]);
  });

  it('resumes typed-block parsing after a closed ordinary fence', () => {
    const content = [
      'Before',
      '```json',
      '```folio-block',
      '{"not":"live"}',
      '```',
      '```folio-block',
      '{"live":true}',
      '```',
      'After',
    ].join('\n');

    expect(parseAnswerSegments(content)).toEqual([
      text('Before\n```json\n```folio-block\n{"not":"live"}\n```'),
      block('{"live":true}'),
      text('After'),
    ]);
  });

  it('does not treat inline or invalid-info backticks as delimiters', () => {
    const content = [
      'Text ```folio-block',
      '{"inline":true}',
      '```folio-block`',
      '```folio-block',
      '{"live":true}',
      '```',
    ].join('\n');

    expect(parseAnswerSegments(content)).toEqual([
      text('Text ```folio-block\n{"inline":true}\n```folio-block`'),
      block('{"live":true}'),
    ]);
  });

  it('keeps a typed block open until its matching marker is complete', () => {
    const content = ['~~~folio-block', '{"partial":', '```', '~~', '~~~'].join('\n');

    expect(parseAnswerSegments(content)).toEqual([block(['{"partial":', '```', '~~'].join('\n'))]);
  });
});

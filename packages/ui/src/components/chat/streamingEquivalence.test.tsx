import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { installHappyDom } from '../../test/setupHappyDom';
import { StreamingMarkdown } from './StreamingMarkdown';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const LONG_ANSWER = readFileSync(new URL('./__fixtures__/long-answer.md', import.meta.url), 'utf8');

const MIXED = [
  '# Heading',
  '',
  'Intro with **bold**, `code`, and a [link](https://example.com/report).',
  '',
  '| Metric | 2024 | 2025 |',
  '| --- | --- | --- |',
  '| Revenue | 1.2B | 1.5B |',
  '| Margin | 41% | 43% |',
  '',
  '- one',
  '- two',
  '',
  '> a quote',
  '',
  '```json',
  '{"ok":true}',
  '```',
  '',
  'Closing paragraph.',
].join('\n');

async function renderStatic(content: string): Promise<string> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<StreamingMarkdown content={content} streaming={false} />);
  });
  return container.innerHTML;
}

async function renderStreamed(content: string, step = 17): Promise<string> {
  const container = document.createElement('div');
  const root = createRoot(container);
  for (let end = step; end < content.length; end += step) {
    const slice = content.slice(0, end);
    await act(async () => {
      root.render(<StreamingMarkdown content={slice} streaming />);
    });
  }
  await act(async () => {
    root.render(<StreamingMarkdown content={content} streaming />);
  });
  return container.innerHTML;
}

describe('StreamingMarkdown — streamed completion equals static render', () => {
  it('matches a static render for a mixed Markdown answer', async () => {
    expect(await renderStreamed(MIXED)).toBe(await renderStatic(MIXED));
  });

  it('matches a static render for the long research fixture', async () => {
    expect(await renderStreamed(LONG_ANSWER, 29)).toBe(await renderStatic(LONG_ANSWER));
  });

  it('matches a static render even when links are sanitized', async () => {
    const doc = 'See [bad](javascript:alert(1)) and [good](https://example.com/x).';
    expect(await renderStreamed(doc)).toBe(await renderStatic(doc));
  });
});

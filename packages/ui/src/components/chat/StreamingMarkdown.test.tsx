import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { StreamingMarkdown, splitStableTail } from './StreamingMarkdown';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

async function renderMarkdown(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

const PARTIAL_CASES: Array<{ name: string; partial: string }> = [
  { name: 'unclosed fenced code block', partial: 'Intro paragraph.\n\n```ts\nconst value = 1' },
  { name: 'unclosed GFM table', partial: 'Intro paragraph.\n\n| A | B |\n| --- | --- |\n| 1 |' },
  { name: 'unclosed unordered list', partial: 'Intro paragraph.\n\n- one\n- two' },
  { name: 'unclosed ordered list', partial: 'Intro paragraph.\n\n1. one\n2. two' },
  { name: 'unclosed blockquote', partial: 'Intro paragraph.\n\n> a quoted line' },
  { name: 'dangling emphasis', partial: 'Intro paragraph.\n\n**bold' },
  { name: 'unfinished link', partial: 'Intro paragraph.\n\nsee [report](https://exa' },
  { name: 'partial html entity', partial: 'Intro paragraph.\n\nAT&amp' },
  { name: 'unclosed math fence', partial: 'Intro paragraph.\n\n$$\nx = 1' },
];

describe('StreamingMarkdown — partial deltas never break the tree', () => {
  for (const { name, partial } of PARTIAL_CASES) {
    it(`keeps prior text when the tail is an ${name}`, async () => {
      const container = await renderMarkdown(<StreamingMarkdown content={partial} streaming />);
      expect(container.textContent).toContain('Intro paragraph.');
      expect(container.querySelector('script')).toBeNull();
    });
  }

  it('upgrades a fenced code block once it closes', async () => {
    const open = 'Intro.\n\n```json\n{"ok":true}';
    const closed = `${open}\n\`\`\``;

    const incomplete = await renderMarkdown(<StreamingMarkdown content={open} streaming />);
    expect(incomplete.textContent).toContain('Intro.');

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<StreamingMarkdown content={closed} streaming />);
    });
    expect(container.querySelector('pre code')?.textContent).toContain('{"ok":true}');
  });
});

describe('splitStableTail', () => {
  it('never cuts inside a fenced code block', () => {
    const content = 'A\n\nB\n\n```\ncode\n\nstill code\n```\n\nC';
    const { stable, tail } = splitStableTail(content);
    // The blank line inside the fence must not become the boundary.
    expect(stable.endsWith('```')).toBe(true);
    expect(stable).toContain('still code');
    expect(tail.trim()).toBe('C');
  });

  it('falls back to a single tail when there is no block boundary', () => {
    const { stable, tail } = splitStableTail('no blank lines here');
    expect(stable).toBe('');
    expect(tail).toBe('no blank lines here');
  });
});

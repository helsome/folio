import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { StreamingMarkdown } from './StreamingMarkdown';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const DOC = [
  '# Fuzz target',
  '',
  'Intro with **bold**, `code`, _emphasis_ and a [link](https://example.com/x).',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- one',
  '- two',
  '- three',
  '',
  '> quoted',
  '',
  '```js',
  'const x = 1;',
  '',
  '```',
  '',
  'Trailing paragraph with a `sk-abcdefghijklmnopqrstuvwx` looking token.',
].join('\n');

/** Deterministic PRNG so a failing case is always reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function renderStreaming(content: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<StreamingMarkdown content={content} streaming />);
  });
  return container;
}

describe('StreamingMarkdown — streaming fuzz', () => {
  it(
    'never throws on random truncations and converges to the static render',
    async () => {
      const random = mulberry32(20260911);

      for (let index = 0; index < 40; index += 1) {
        const cut = Math.floor(random() * (DOC.length + 1));
        const container = await renderStreaming(DOC.slice(0, cut));
        expect(container.querySelector('script')).toBeNull();
      }

      const streamed = await renderStreaming(DOC);

      const staticContainer = document.createElement('div');
      const staticRoot = createRoot(staticContainer);
      await act(async () => {
        staticRoot.render(<StreamingMarkdown content={DOC} streaming={false} />);
      });

      expect(streamed.innerHTML).toBe(staticContainer.innerHTML);
    },
    30000,
  );
});

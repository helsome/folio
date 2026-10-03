import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { LONG_ANSWER_MARKDOWN, STREAMING_MARKDOWN_FIXTURES } from '../../test/streamingMarkdownFixtures';
import { MarkdownContent } from './MarkdownContent';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/** Mount streamed Markdown and let the 16ms coalescing buffer commit. */
async function mountStreaming(content: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} streaming />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return { container, root };
}

/** Deliver the next delta to an existing streamed root and let it commit. */
async function pushDelta(root: Root, content: string): Promise<void> {
  await act(async () => {
    root.render(<MarkdownContent content={content} streaming />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function mountStatic(content: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} />);
  });
  return { container, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function fixtureNamed(name: string): (typeof STREAMING_MARKDOWN_FIXTURES)[number] {
  const fixture = STREAMING_MARKDOWN_FIXTURES.find((entry) => entry.name === name);
  if (!fixture) throw new Error(`Missing streaming fixture: ${name}`);
  return fixture;
}

describe('streaming Markdown fixtures (#28)', () => {
  for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
    it(`keeps "${fixture.name}" renderable while streaming`, async () => {
      const { container, root } = await mountStreaming(fixture.partial);

      expect(container.textContent).toContain(fixture.stableText);
      if (fixture.partialSelector) {
        expect(container.querySelector(fixture.partialSelector)).not.toBeNull();
      }

      await unmount(root);
    });
  }

  it('matches static semantics for every completed fixture', async () => {
    for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
      const { container: streamingContainer, root } = await mountStreaming(fixture.complete);
      const { container: staticContainer, root: staticRoot } = await mountStatic(fixture.complete);

      expect(streamingContainer.textContent).toBe(staticContainer.textContent);

      await unmount(root);
      await unmount(staticRoot);
    }
  });

  it('commits later deltas instead of freezing the first streamed frame', async () => {
    const fixture = fixtureNamed('unclosed ordered list');
    const { container, root } = await mountStreaming(fixture.partial);

    // Intermediate frame: the third item exists but has no text yet.
    const partialItems = container.querySelectorAll('ol li');
    expect(partialItems).toHaveLength(3);
    expect(partialItems[2]?.textContent).toBe('');

    await pushDelta(root, fixture.complete);

    // A stream frozen at its first frame would still show the empty item.
    const completedItems = container.querySelectorAll('ol li');
    expect(completedItems).toHaveLength(3);
    expect(completedItems[2]?.textContent).toBe('Free cash flow');

    await unmount(root);
  });

  it('turns a half-open citation marker into a link when the stream closes it', async () => {
    const fixture = fixtureNamed('unclosed citation marker');
    const { container, root } = await mountStreaming(fixture.partial);

    expect(container.querySelector('a')).toBeNull();

    await pushDelta(root, fixture.complete);

    expect(container.querySelector('a[href="https://example.com/audit"]')?.textContent).toBe('1');

    await unmount(root);
  });

  it('renders the long financial answer without dropping structure', async () => {
    const { container, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);

    expect(container.querySelector('h1')?.textContent).toBe('Quarterly Investment Review');
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(5);
    expect(container.querySelectorAll('li')).toHaveLength(8);
    expect(container.querySelector('blockquote')?.textContent).toContain('portfolio review');
    expect(container.querySelector('pre code')?.textContent).toContain('"fcf": 312');
    expect(container.querySelector('a[href="https://example.com/results"]')?.textContent).toBe('audited results');

    await unmount(root);
  });

  it('keeps raw HTML inert and unsafe URLs out of the streamed DOM', async () => {
    const { container, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);

    // Raw HTML is escaped to text, never becoming live nodes.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    // The hostile paragraph really parses as links, proven by the control
    // link: without it these assertions could pass on text that never became
    // a link in the first place.
    expect(container.querySelector('a[href="https://example.com/safe"]')?.textContent).toBe('Safe');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="//"]')).toBeNull();
    expect(container.textContent).toContain('Unsafe');
    expect(container.textContent).toContain('Phish');

    await unmount(root);
  });

  it('keeps streamed and static long answers semantically identical', async () => {
    const { container: streamingContainer, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);
    const { container: staticContainer, root: staticRoot } = await mountStatic(LONG_ANSWER_MARKDOWN);

    expect(streamingContainer.textContent).toBe(staticContainer.textContent);
    expect(streamingContainer.querySelectorAll('table')).toHaveLength(1);
    expect(streamingContainer.querySelectorAll('a[href^="https://"]')).not.toHaveLength(0);

    await unmount(root);
    await unmount(staticRoot);
  });
});

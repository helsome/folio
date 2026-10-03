import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { LONG_ANSWER_MARKDOWN, STREAMING_MARKDOWN_FIXTURES } from '../../lib/streaming-markdown-fixtures';
import { MarkdownContent } from './MarkdownContent';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

async function renderStreaming(container: HTMLDivElement, content: string): Promise<void> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} streaming />);
  });
  // Let the buffered content settle into act() after the render effects run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function renderStatic(container: HTMLDivElement, content: string): Promise<void> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} />);
  });
}

describe('streaming Markdown fixtures (#28)', () => {
  for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
    it(`keeps "${fixture.name}" renderable while streaming`, async () => {
      const container = document.createElement('div');
      await renderStreaming(container, fixture.partial);

      expect(container.textContent).toContain(fixture.stableText);
    });
  }

  it('matches static semantics for every completed fixture', async () => {
    for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
      const streamingContainer = document.createElement('div');
      const staticContainer = document.createElement('div');
      await renderStreaming(streamingContainer, fixture.complete);
      await renderStatic(staticContainer, fixture.complete);

      expect(streamingContainer.textContent).toBe(staticContainer.textContent);
    }
  });

  it('coalesces rapid deltas into the completed answer', async () => {
    const fixture = STREAMING_MARKDOWN_FIXTURES[0];
    const streamingContainer = document.createElement('div');
    const streamingRoot = createRoot(streamingContainer);
    const staticContainer = document.createElement('div');
    const staticRoot = createRoot(staticContainer);

    await act(async () => {
      streamingRoot.render(<MarkdownContent content={fixture.partial} streaming />);
      streamingRoot.render(<MarkdownContent content={fixture.complete} streaming />);
      staticRoot.render(<MarkdownContent content={fixture.complete} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(streamingContainer.textContent).toBe(staticContainer.textContent);
    expect(streamingContainer.querySelector('pre code')?.textContent).toContain('const margin');
  });

  it('renders the long financial answer without dropping structure', async () => {
    const container = document.createElement('div');
    await renderStreaming(container, LONG_ANSWER_MARKDOWN);

    expect(container.querySelector('h1')?.textContent).toBe('Quarterly Investment Review');
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(5);
    expect(container.querySelectorAll('li')).toHaveLength(8);
    expect(container.querySelector('blockquote')?.textContent).toContain('portfolio review');
    expect(container.querySelector('pre code')?.textContent).toContain('"fcf": 312');
    expect(container.querySelector('a[href="https://example.com/results"]')?.textContent).toBe('audited results');
  });

  it('keeps raw HTML and unsafe URLs out of the streamed DOM', async () => {
    const container = document.createElement('div');
    await renderStreaming(container, LONG_ANSWER_MARKDOWN);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="//"]')).toBeNull();
    expect(container.textContent).toContain('alert(1)');
    expect(container.textContent).toContain('Phish');
  });

  it('keeps streamed and static long answers semantically identical', async () => {
    const streamingContainer = document.createElement('div');
    const staticContainer = document.createElement('div');
    await renderStreaming(streamingContainer, LONG_ANSWER_MARKDOWN);
    await renderStatic(staticContainer, LONG_ANSWER_MARKDOWN);

    expect(streamingContainer.textContent).toBe(staticContainer.textContent);
    expect(streamingContainer.querySelectorAll('table')).toHaveLength(1);
    expect(streamingContainer.querySelectorAll('a[href^="https://"]')).not.toHaveLength(0);
  });
});

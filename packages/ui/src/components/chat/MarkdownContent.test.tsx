import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { MarkdownContent, StreamingMarkdownContent } from './MarkdownContent';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

describe('MarkdownContent', () => {
  it('renders common research Markdown as semantic elements', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownContent
          content={'## Outlook\n\n**Positive** with `PE 34.63`.\n\n- Revenue\n- Services\n\n```json\n{"ok":true}\n```'}
        />
      );
    });

    expect(container.querySelector('h2')?.textContent).toBe('Outlook');
    expect(container.querySelector('strong')?.textContent).toBe('Positive');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toContain('{"ok":true}');
  });

  it('does not render raw HTML from agent output', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownContent content={'<script>alert(1)</script>\n\nVisible text'} />);
    });

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('Visible text');
  });

  it('allows http(s) links and removes unsafe URL schemes', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownContent content={'[Evidence](https://example.com/report) [Attack](javascript:alert(1))'} />
      );
    });

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/report');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toContain('Attack');
  });

  it('keeps incomplete streamed structures renderable and preserves earlier content', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const updates = [
      '# Report\n\nOpening evidence.\n\n```ts\nconst value =',
      '# Report\n\nOpening evidence.\n\n```ts\nconst value = 42;\n```\n\n| Metric | Value |',
      '# Report\n\nOpening evidence.\n\n```ts\nconst value = 42;\n```\n\n| Metric | Value |\n| --- | --- |\n| PE | 34.6 |\n\n- first\n-',
    ];

    for (const content of updates) {
      await act(async () => {
        root.render(<StreamingMarkdownContent content={content} />);
      });
      expect(container.textContent).toContain('Report');
      expect(container.textContent).toContain('Opening evidence.');
    }

    expect(container.querySelector('pre code')?.textContent).toContain('const value = 42;');
    expect(container.querySelector('table')?.textContent).toContain('34.6');
  });

  it('matches static Markdown semantics after a long streamed answer completes', async () => {
    const streamedContainer = document.createElement('div');
    const staticContainer = document.createElement('div');
    const streamedRoot = createRoot(streamedContainer);
    const staticRoot = createRoot(staticContainer);
    const content = Array.from(
      { length: 80 },
      (_, index) => `## Section ${index + 1}\n\nParagraph with **evidence ${index + 1}** and [source](https://example.com/${index + 1}).`,
    ).join('\n\n');

    for (let end = 127; end < content.length; end += 127) {
      await act(async () => {
        streamedRoot.render(<StreamingMarkdownContent content={content.slice(0, end)} />);
      });
    }
    await act(async () => {
      streamedRoot.render(<StreamingMarkdownContent content={content} />);
      staticRoot.render(<MarkdownContent content={content} />);
    });

    const semanticHtml = (value: string) => value.replace(/>\s+</g, '><');
    expect(semanticHtml(streamedContainer.innerHTML)).toBe(semanticHtml(staticContainer.innerHTML));
  });
});

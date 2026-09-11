import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { MarkdownContent } from './MarkdownContent';

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

  it('renders GFM tables and removes unsafe links', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownContent
          content={'| Metric | Value |\n| --- | ---: |\n| Margin | 12% |\n\n[Safe](https://example.com) [Unsafe](javascript:alert(1)) [Data](data:text/html,boom)'}
        />
      );
    });

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('a[href="https://example.com"]')?.textContent).toBe('Safe');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="data:"]')).toBeNull();
    expect(container.textContent).toContain('Unsafe');
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

  it('keeps partial blocks stable and matches static rendering when complete', async () => {
    const streamingContainer = document.createElement('div');
    const streamingRoot = createRoot(streamingContainer);
    const staticContainer = document.createElement('div');
    const staticRoot = createRoot(staticContainer);
    const complete = '## Partial\n\n| Metric | Value |\n| --- | --- |\n| Revenue | $10M |';

    act(() => {
      streamingRoot.render(<MarkdownContent content={complete} streaming />);
      staticRoot.render(<MarkdownContent content={complete} />);
    });

    expect(streamingContainer.querySelector('table')).not.toBeNull();
    expect(staticContainer.querySelector('table')).not.toBeNull();
    expect(streamingContainer.textContent).toBe(staticContainer.textContent);
  });
});

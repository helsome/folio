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

  it('does not render raw HTML from agent output', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownContent content={'<script>alert(1)</script>\n\nVisible text'} />);
    });

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('Visible text');
  });
});

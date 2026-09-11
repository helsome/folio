import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { StreamingMarkdown, redactSecrets, sanitizeUrl } from './StreamingMarkdown';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

async function renderMarkdown(content: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<StreamingMarkdown content={content} />);
  });
  return container;
}

describe('sanitizeUrl — scheme allow-list', () => {
  const blocked = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html;base64,PHNjcmlwdD4=',
    'blob:https://example.com/abc',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//evil.example.com/x',
    'relative/path.md',
  ];

  for (const url of blocked) {
    it(`neutralizes ${JSON.stringify(url)}`, () => {
      expect(sanitizeUrl(url)).toBe('#');
    });
  }

  const allowed: Array<[string, string]> = [
    ['https://example.com/a?b=c#d', 'https://example.com/a?b=c#d'],
    ['http://example.com', 'http://example.com'],
    ['mailto:analyst@example.com', 'mailto:analyst@example.com'],
    ['#section-2', '#section-2'],
  ];

  for (const [url, expected] of allowed) {
    it(`allows ${url}`, () => {
      expect(sanitizeUrl(url)).toBe(expected);
    });
  }

  it('returns empty for nullish or empty input', () => {
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl(undefined)).toBe('');
    expect(sanitizeUrl(null)).toBe('');
  });
});

describe('redactSecrets', () => {
  it('redacts key-shaped tokens', () => {
    expect(redactSecrets('token sk-abcdefghijklmnopqrstuvwx')).toBe('token [redacted]');
  });

  it('redacts bearer and authorization values', () => {
    const output = redactSecrets('Authorization: Bearer abcdefghijklmnop');
    expect(output).not.toContain('abcdefghijklmnop');
    expect(output).toContain('[redacted]');
  });
});

describe('StreamingMarkdown — XSS regressions', () => {
  it('never renders raw <script> from model output', async () => {
    const container = await renderMarkdown('<script>alert(1)</script>\n\nVisible text');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('Visible text');
  });

  it('does not materialize inline event handlers from raw HTML', async () => {
    const container = await renderMarkdown('<img src=x onerror=alert(1)>\n\nBody');
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('neutralizes dangerous link schemes in Markdown links', async () => {
    const container = await renderMarkdown('[c](javascript:alert(1))\n\n[o](https://ok.example.com)');
    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.toLowerCase().includes('javascript'))).toBe(false);
    expect(hrefs).toContain('https://ok.example.com');
  });

  it('redacts canary-shaped secrets before they reach the DOM', async () => {
    const container = await renderMarkdown('leaked sk-abcdefghijklmnopqrstuvwx value');
    expect(container.textContent).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(container.textContent).toContain('[redacted]');
  });
});

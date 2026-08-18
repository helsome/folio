import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { ExportMenu } from './ExportMenu';

let restoreDom: (() => void) | undefined;
let clipboardWrites: string[] = [];
let lastDownload: { name: string; href: string } | null = null;
const markdownCalls: Array<{ reportId: string }> = [];
const shareCardCalls: Array<{ reportId: string }> = [];
const markdownMock = async (input: { reportId: string }) => {
  markdownCalls.push(input);
  return { ok: true as const, data: '**markdown**' };
};
const shareCardMock = async (input: { reportId: string }) => {
  shareCardCalls.push(input);
  return { ok: true as const, data: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', text: 'share text' } };
};
let originalClipboard: Clipboard | undefined;
let anchorElement: { prototype: { click: () => void } } | undefined;
let originalClick: (() => void) | undefined;
let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
  (window as { electronAPI?: unknown }).electronAPI = { export: { markdown: markdownMock, shareCard: shareCardMock } };

  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        clipboardWrites.push(text);
      },
    },
  });

  // happy-dom does not surface HTMLAnchorElement as a global; reach it through
  // the happy-dom Window so the component's createElement('a') click is captured.
  anchorElement = (window as unknown as { HTMLAnchorElement?: { prototype: { click: () => void } } })
    .HTMLAnchorElement;
  if (anchorElement?.prototype) {
    originalClick = anchorElement.prototype.click;
    anchorElement.prototype.click = function (this: { download: string; href: string }) {
      lastDownload = { name: this.download, href: this.href };
    };
  }

  originalCreateObjectUrl = URL.createObjectURL;
  originalRevokeObjectUrl = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
});

afterAll(() => {
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
  } else {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  }
  if (originalClick && anchorElement) anchorElement.prototype.click = originalClick;
  if (originalCreateObjectUrl) URL.createObjectURL = originalCreateObjectUrl;
  if (originalRevokeObjectUrl) URL.revokeObjectURL = originalRevokeObjectUrl;
  restoreDom?.();
});

beforeEach(() => {
  clipboardWrites = [];
  lastDownload = null;
  markdownCalls.length = 0;
  shareCardCalls.length = 0;
});

function report(): ResearchReport {
  return {
    id: 'rpt_ui_1',
    symbol: 'AAPL.US',
    generatedAt: 1_784_000_000_000,
    strategyId: 'growth',
    summary: 'Summary text.',
    stance: 'bullish',
    confidence: 0.82,
    sections: [
      { key: 'growth', title: 'Growth', verdict: 'positive', summary: 'a', evidence: [] },
    ],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: ['Key risk line.'],
    capabilityRuns: [],
    runStatus: 'completed',
  };
}

function renderMenu() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <TestI18n>
        <ExportMenu report={report()} />
      </TestI18n>
    );
  });
  return { container, root };
}

function byTestId(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

describe('ExportMenu', () => {
  it('opens a menu with all four export actions', async () => {
    const { container, root } = renderMenu();
    expect(byTestId(container, 'export-menu-panel')).toBeNull();
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    const panel = byTestId(container, 'export-menu-panel');
    expect(panel).not.toBeNull();
    for (const testId of [
      'export-copy-markdown',
      'export-download-markdown',
      'export-copy-share-text',
      'export-download-card',
    ]) {
      expect(byTestId(container, testId)).not.toBeNull();
    }
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('Copy Markdown calls the markdown loader and writes the clipboard', async () => {
    const { container, root } = renderMenu();
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    await act(async () => {
      byTestId(container, 'export-copy-markdown')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(markdownCalls).toEqual([{ reportId: 'rpt_ui_1' }]);
    expect(clipboardWrites).toEqual(['**markdown**']);
    expect(byTestId(container, 'export-menu-panel')).toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('Download .md calls the markdown loader and downloads a .md file', async () => {
    const { container, root } = renderMenu();
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    await act(async () => {
      byTestId(container, 'export-download-markdown')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(markdownCalls).toEqual([{ reportId: 'rpt_ui_1' }]);
    expect(lastDownload?.name).toBe('AAPL.US-research.md');
    expect(lastDownload?.href).toBe('blob:mock');
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('Copy share text calls the shareCard loader and writes the share text', async () => {
    const { container, root } = renderMenu();
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    await act(async () => {
      byTestId(container, 'export-copy-share-text')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(shareCardCalls).toEqual([{ reportId: 'rpt_ui_1' }]);
    expect(clipboardWrites).toEqual(['share text']);
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('Download share card calls the shareCard loader and downloads an .svg file', async () => {
    const { container, root } = renderMenu();
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    await act(async () => {
      byTestId(container, 'export-download-card')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(shareCardCalls).toEqual([{ reportId: 'rpt_ui_1' }]);
    expect(lastDownload?.name).toBe('AAPL.US-share-card.svg');
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows an error state when the export channel is not wired', async () => {
    const { container, root } = renderMenu();
    (window as { electronAPI?: unknown }).electronAPI = undefined;
    act(() => {
      byTestId(container, 'export-menu-trigger')?.click();
    });
    await act(async () => {
      byTestId(container, 'export-copy-markdown')?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(markdownCalls).toEqual([]);
    expect(byTestId(container, 'export-menu-error')?.textContent).toContain('Export unavailable');
    (window as { electronAPI?: unknown }).electronAPI = {
      export: { markdown: markdownMock, shareCard: shareCardMock },
    };
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

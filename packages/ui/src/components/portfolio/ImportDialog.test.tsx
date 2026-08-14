import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResult, ManualPortfolio, PortfolioImportDraft, PortfolioImportRow } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { ImportDialog } from './ImportDialog';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

function row(overrides: Partial<PortfolioImportRow>): PortfolioImportRow {
  return {
    symbol: 'AAPL.US',
    name: 'Apple',
    quantity: 100,
    costPrice: 180.5,
    currency: 'USD',
    confidence: 1.0,
    issues: [],
    ...overrides,
  };
}

function makeDraft(): PortfolioImportDraft {
  return {
    id: 'draft_test',
    source: 'paste',
    rows: [
      row({}),
      row({ symbol: '0700.HK', name: 'Tencent', quantity: 500, costPrice: 320, currency: 'HKD' }),
    ],
    importedAt: 1_000,
    warnings: [],
  };
}

/** Stub the preload surface the loaders read (`window.electronAPI`). */
function stubApi(
  overrides: {
    parse?: (input: { source: string; text: string }) => Promise<ApiResult<PortfolioImportDraft>>;
    confirm?: (input: { draft: PortfolioImportDraft; name: string }) => Promise<ApiResult<ManualPortfolio>>;
  } = {}
) {
  const api = {
    portfolioImport: {
      parse: overrides.parse ?? (async () => ({ ok: true as const, data: makeDraft() })),
      confirm:
        overrides.confirm ??
        (async (input: { draft: PortfolioImportDraft; name: string }) => ({
          ok: true as const,
          data: {
            id: 'manual_1',
            name: input.name,
            holdings: [],
            updatedAt: 1_000,
          } satisfies ManualPortfolio,
        })),
      listManual: async () => ({ ok: true as const, data: [] }),
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
}

async function render(onImported: () => void = () => {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ImportDialog open onClose={() => {}} onImported={onImported} />);
  });
  return { container, root };
}

describe('ImportDialog', () => {
  it('offers Paste / CSV / Screenshot source buttons', async () => {
    const { container } = await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Paste holdings');
    expect(text).toContain('Import CSV file');
    expect(text).toContain('Screenshot (coming soon)');
    const buttons = Array.from(container.querySelectorAll('button'));
    const screenshot = buttons.find((button) => button.textContent?.includes('Screenshot'));
    expect((screenshot as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs the full paste → review → confirm flow through the stubbed client', async () => {
    let parsedSource = '';
    let confirmedName = '';
    let imported = false;
    stubApi({
      parse: async (input) => {
        parsedSource = input.source;
        const draft = makeDraft();
        return { ok: true, data: draft };
      },
      confirm: async (input) => {
        confirmedName = input.name;
        return {
          ok: true,
          data: { id: 'manual_1', name: input.name, holdings: [], updatedAt: 1_000 },
        };
      },
    });
    const { container, root } = await render(() => {
      imported = true;
    });

    // Paste step
    await act(async () => {
      const pasteButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Paste holdings')
      );
      pasteButton?.click();
    });
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) {
        // Uncontrolled textarea — direct DOM write is read at Parse time.
        textarea.value = 'AAPL.US 100 180.5\n0700.HK 500 320';
      }
    });
    await act(async () => {
      const parseButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Parse')
      );
      parseButton?.click();
    });

    // Review step: rows visible, then confirm.
    const reviewText = container.textContent ?? '';
    expect(parsedSource).toBe('paste');
    expect(reviewText).toContain('AAPL.US');
    expect(reviewText).toContain('0700.HK');
    await act(async () => {
      const confirmButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Confirm Import')
      );
      confirmButton?.click();
    });
    expect(confirmedName).toBe('Manual Portfolio');
    expect(imported).toBe(true);
    await act(async () => root.unmount());
  });

  it('renders warnings and review-required rows after parsing low-confidence input', async () => {
    stubApi({
      parse: async () => ({
        ok: true,
        data: {
          id: 'draft_low',
          source: 'paste',
          rows: [
            row({}),
            row({
              symbol: 'TSLA',
              confidence: 0.3,
              issues: ['Symbol "TSLA" is missing a market suffix (e.g. TSLA.US)'],
            }),
          ],
          importedAt: 1_000,
          warnings: ['1 row needs review'],
        },
      }),
    });
    const { container } = await render();

    await act(async () => {
      const pasteButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Paste holdings')
      );
      pasteButton?.click();
    });
    const textarea = container.querySelector('textarea');
    await act(async () => {
      if (textarea) {
        textarea.value = 'TSLA 100 200';
      }
    });
    await act(async () => {
      const parseButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Parse')
      );
      parseButton?.click();
    });

    const text = container.textContent ?? '';
    expect(text).toContain('1 row needs review');
    expect(text).toContain('review required');
    expect(text).toContain('TSLA');
  });

  it('shows an error when parsing is unavailable (channel absent)', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
    const { container } = await render();

    await act(async () => {
      const pasteButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Paste holdings')
      );
      pasteButton?.click();
    });
    const textarea = container.querySelector('textarea');
    await act(async () => {
      if (textarea) {
        textarea.value = 'AAPL.US 100 180.5';
      }
    });
    await act(async () => {
      const parseButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Parse')
      );
      parseButton?.click();
    });
    expect(container.textContent).toContain('not available in this build');
  });
});

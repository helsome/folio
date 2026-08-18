import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PortfolioImportDraft, PortfolioImportRow } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { ImportDraftReview, confidenceVisual } from './ImportDraftReview';

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

function draft(rows: PortfolioImportRow[], warnings: string[] = []): PortfolioImportDraft {
  return {
    id: 'draft_test',
    source: 'paste',
    rows,
    importedAt: 1_000,
    warnings,
  };
}

async function render(
  d: PortfolioImportDraft,
  onConfirm: (name: string) => void = () => {},
  onCancel: () => void = () => {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      withI18n(
        <ImportDraftReview draft={d} onConfirm={onConfirm} onCancel={onCancel} />
      )
    );
  });
  return { container, root };
}

describe('confidenceVisual (spec §48)', () => {
  it('maps the three tiers to translation keys', () => {
    expect(confidenceVisual(1.0)).toEqual({ key: 'portfolio.confidence.high', tone: 'high' });
    expect(confidenceVisual(0.6)).toEqual({ key: 'portfolio.confidence.review', tone: 'medium' });
    expect(confidenceVisual(0.3)).toEqual({ key: 'portfolio.confidence.needsReview', tone: 'low' });
  });
});

describe('ImportDraftReview', () => {
  it('renders every row with symbol, name, qty, cost, currency', async () => {
    const { container } = await render(
      draft([
        row({}),
        row({ symbol: '0700.HK', name: 'Tencent', quantity: 500, costPrice: 320, currency: 'HKD' }),
      ])
    );
    const text = container.textContent ?? '';
    expect(text).toContain('AAPL.US');
    expect(text).toContain('Apple');
    expect(text).toContain('Tencent');
    expect(text).toContain('0700.HK');
  });

  it('renders the warnings banner', async () => {
    const { container } = await render(
      draft([row({ confidence: 0.6, issues: ['Quantity missing'] })], ['1 row needs review'])
    );
    expect(container.textContent).toContain('1 row needs review');
  });

  it('highlights low-confidence rows as review required', async () => {
    const { container } = await render(
      draft([row({}), row({ symbol: 'TSLA', confidence: 0.3, issues: ['Symbol "TSLA" is missing a market suffix (e.g. TSLA.US)'] })])
    );
    const text = container.textContent ?? '';
    expect(text).toContain('review required');
    expect(text).toContain('Needs review');
    const rows = Array.from(container.querySelectorAll('tr'));
    const highlighted = rows.filter((row) => row.className.includes('mac-yellow'));
    expect(highlighted.length).toBe(1);
  });

  it('shows per-row issues in the table', async () => {
    const { container } = await render(
      draft([row({ confidence: 0.6, issues: ['Cost price missing'] })])
    );
    expect(container.textContent).toContain('Cost price missing');
  });

  it('confirm calls onConfirm with the portfolio name', async () => {
    const seen: { name: string | null } = { name: null };
    const { container, root } = await render(draft([row({})]), (name) => {
      seen.name = name;
    });
    const nameInput = container.querySelector('input');
    expect(nameInput).not.toBeNull();
    await act(async () => {
      if (nameInput) {
        // Uncontrolled input — direct DOM write is read at confirm time.
        nameInput.value = 'My Book';
      }
    });
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll('button'));
      const confirmButton = buttons.find((button) => button.textContent === 'Confirm Import');
      expect(confirmButton).not.toBeUndefined();
      confirmButton?.click();
    });
    expect(seen.name).toBe('My Book');
    await act(async () => root.unmount());
  });

  it('cancel calls onCancel', async () => {
    let canceled = false;
    const { container } = await render(draft([row({})]), () => {}, () => {
      canceled = true;
    });
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll('button'));
      const cancelButton = buttons.find((button) => button.textContent === 'Cancel');
      expect(cancelButton).not.toBeUndefined();
      cancelButton?.click();
    });
    expect(canceled).toBe(true);
  });

  it('disables confirm when there are no rows', async () => {
    const { container } = await render(draft([]));
    const buttons = Array.from(container.querySelectorAll('button'));
    const confirmButton = buttons.find((button) => button.textContent === 'Confirm Import');
    expect(confirmButton).not.toBeUndefined();
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
  });
});

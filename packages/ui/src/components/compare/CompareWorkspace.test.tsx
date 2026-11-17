import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { Comparison } from '@finagent/core';
import { compareSymbolsAtom, compareViewSettingsAtom } from '../../atoms/compareAtoms';
import { readPersisted } from '../../lib/persistedPrefs';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { CompareWorkspace } from './CompareWorkspace';
import {
  createSavedCompareView,
  loadSavedCompareViews,
  persistSavedCompareViews,
  SAVED_COMPARE_VIEWS_STORAGE_KEY,
  writeLastSavedCompareViewId,
} from '../../lib/compareViewState';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

beforeEach(() => {
  window.localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function comparisonFor(symbols: string[]): Comparison {
  const cells = Object.fromEntries(symbols.map((symbol, index) => [
    symbol,
    { value: 100 + index, display: `$${100 + index}.00`, missing: false },
  ]));
  return {
    symbols,
    generatedAt: 1_700_000_000_000,
    errors: {},
    rows: [
      { metric: 'Price', cells },
      { metric: 'PE', cells },
      { metric: 'ROE', cells },
      { metric: '1M Return', cells },
      { metric: '3M Return', cells },
    ],
  };
}

function installCompareApi(buildCalls: string[][]) {
  const electronAPI = {
    compare: {
      build: async (symbols: string[]) => {
        buildCalls.push(symbols);
        return { ok: true, data: comparisonFor(symbols) };
      },
    },
  };
  (window as unknown as { electronAPI: typeof electronAPI }).electronAPI = electronAPI;
}

async function flushAsync(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderWorkspace(store = createStore()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      withI18n(
        <Provider store={store}>
          <CompareWorkspace />
        </Provider>
      )
    );
  });
  await flushAsync();
  return { container, root, store };
}

async function setControlValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string
): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CompareWorkspace saved views', () => {
  it('restores the last saved view on mount and refetches fresh comparison data', async () => {
    const view = createSavedCompareView({
      id: 'saved-tech',
      name: 'Tech one-month',
      symbols: ['AAPL.US', 'MSFT.US'],
      settings: {
        metricPreset: 'priceReturns',
        returnWindow: '1m',
        density: 'compact',
        visibleMetricIds: ['price', 'return1m', 'momentum'],
      },
      now: 100,
    });
    persistSavedCompareViews([view]);
    writeLastSavedCompareViewId(view.id);
    const buildCalls: string[][] = [];
    installCompareApi(buildCalls);

    const { container, root, store } = await renderWorkspace();

    try {
      expect(buildCalls).toEqual([['AAPL.US', 'MSFT.US']]);
      expect(store.get(compareSymbolsAtom)).toEqual(['AAPL.US', 'MSFT.US']);
      expect(store.get(compareViewSettingsAtom)).toEqual({
        metricPreset: 'priceReturns',
        returnWindow: '1m',
        density: 'compact',
        visibleMetricIds: ['price', 'return1m', 'momentum'],
      });

      const tableText = container.querySelector('[data-testid="compare-table"]')?.textContent ?? '';
      expect(tableText).toContain('1M Return');
      expect(tableText).not.toContain('3M Return');
      expect(tableText).not.toContain('ROE');
      expect(container.querySelector('[data-testid="compare-saved-view-select"]')?.textContent).toContain('Tech one-month');
      expect(container.querySelector('td')?.className).toContain('py-1.5');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('saves current symbols, metrics, return window and density, then deletes the view', async () => {
    const buildCalls: string[][] = [];
    installCompareApi(buildCalls);
    const store = createStore();
    store.set(compareSymbolsAtom, ['NVDA.US', 'AMD.US']);
    const { container, root } = await renderWorkspace(store);

    try {
      const metricSelect = container.querySelector<HTMLSelectElement>('[data-testid="compare-metric-preset"]');
      const windowSelect = container.querySelector<HTMLSelectElement>('[data-testid="compare-return-window"]');
      const compact = container.querySelector<HTMLInputElement>('[data-testid="compare-compact-rows"]');
      const nameInput = container.querySelector<HTMLInputElement>('[data-testid="compare-saved-view-name"]');
      if (!metricSelect || !windowSelect || !compact || !nameInput) throw new Error('saved-view controls missing');

      await setControlValue(metricSelect, 'valuation');
      await setControlValue(windowSelect, '3m');
      await setControlValue(nameInput, 'Semiconductor valuation');
      await act(async () => {
        compact.click();
      });
      await flushAsync(2);
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="compare-saved-view-save"]')?.click();
      });

      const stored = readPersisted<{ schemaVersion: number; views: Array<Record<string, unknown>> }>(
        SAVED_COMPARE_VIEWS_STORAGE_KEY,
        { schemaVersion: 0, views: [] }
      );
      expect(stored.schemaVersion).toBe(1);
      expect(stored.views).toHaveLength(1);
      expect(stored.views[0]?.symbols).toEqual(['NVDA.US', 'AMD.US']);
      expect(stored.views[0]?.settings).toEqual({
        metricPreset: 'valuation',
        returnWindow: '3m',
        density: 'compact',
        visibleMetricIds: ['marketCap', 'pe', 'pb', 'dividendYield'],
      });
      expect(loadSavedCompareViews()).toHaveLength(1);

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="compare-saved-view-delete"]')?.click();
      });
      expect(loadSavedCompareViews()).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

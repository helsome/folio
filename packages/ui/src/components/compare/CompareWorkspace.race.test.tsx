import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { Comparison } from '@finagent/core';
import { compareSymbolsAtom, comparisonStateAtom } from '../../atoms/compareAtoms';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { CompareWorkspace } from './CompareWorkspace';

let restoreDom: () => void;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => restoreDom());

const INITIAL = ['AAPL.US', 'MSFT.US'];
const CURRENT = ['AAPL.US', 'NVDA.US'];

interface PendingRequest {
  symbols: string[];
  resolve: (result: unknown) => void;
}

function success(symbols: string[], price: number): { ok: true; data: Comparison } {
  return {
    ok: true,
    data: {
      symbols,
      generatedAt: price,
      errors: {},
      rows: [{ metric: 'Price', cells: Object.fromEntries(symbols.map((symbol) => [
        symbol, { value: price, display: '$' + price, missing: false },
      ])) }],
    },
  };
}

async function setup() {
  window.localStorage.clear();
  const requests: PendingRequest[] = [];
  const api = { compare: { build: (symbols: string[]) => new Promise<unknown>((resolve) => {
    requests.push({ symbols, resolve });
  }) } };
  (window as unknown as { electronAPI: typeof api }).electronAPI = api;
  const store = createStore();
  store.set(compareSymbolsAtom, INITIAL);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(withI18n(<Provider store={store}><CompareWorkspace /></Provider>));
  });
  return { store, requests, container, root };
}

for (const first of ['old', 'new'] as const) {
  it('keeps the current comparison when the ' + first + ' request finishes first', async () => {
    const { store, requests, container, root } = await setup();
    try {
      await act(async () => { store.set(compareSymbolsAtom, CURRENT); });
      expect(requests.map((request) => request.symbols)).toEqual([INITIAL, CURRENT]);
      if (first === 'old') {
        await act(async () => { requests[0].resolve(success(INITIAL, 111)); });
        expect(store.get(comparisonStateAtom)).toMatchObject({ data: null, loading: true, error: null });
        await act(async () => { requests[1].resolve(success(CURRENT, 222)); });
      } else {
        await act(async () => { requests[1].resolve(success(CURRENT, 222)); });
        await act(async () => { requests[0].resolve(success(INITIAL, 111)); });
      }
      expect(store.get(comparisonStateAtom).data?.symbols).toEqual(CURRENT);
      const table = container.querySelector('[data-testid="compare-table"]')?.textContent ?? '';
      expect(table).toContain('NVDA.US');
      expect(table).not.toContain('MSFT.US');
      expect(table).toContain('$222');
    } finally {
      await act(async () => root.unmount());
      await act(async () => { for (const request of requests) request.resolve(null); });
      container.remove();
    }
  });
}

it('ignores an old failure after the current comparison succeeds', async () => {
  const { store, requests, container, root } = await setup();
  try {
    await act(async () => { store.set(compareSymbolsAtom, CURRENT); });
    await act(async () => { requests[1].resolve(success(CURRENT, 222)); });
    await act(async () => { requests[0].resolve({ ok: false, error: { code: 'OLD', message: 'old failure' } }); });
    expect(store.get(comparisonStateAtom).data?.symbols).toEqual(CURRENT);
    expect(store.get(comparisonStateAtom).error).toBeNull();
  } finally {
    await act(async () => root.unmount());
    await act(async () => { for (const request of requests) request.resolve(null); });
    container.remove();
  }
});

it('retains the current error when an older comparison succeeds later', async () => {
  const { store, requests, container, root } = await setup();
  try {
    await act(async () => { store.set(compareSymbolsAtom, CURRENT); });
    await act(async () => { requests[1].resolve({ ok: false, error: { code: 'NEW', message: 'new failure' } }); });
    const currentError = store.get(comparisonStateAtom).error;
    expect(currentError).not.toBeNull();
    await act(async () => { requests[0].resolve(success(INITIAL, 111)); });
    expect(store.get(comparisonStateAtom)).toEqual({ data: null, loading: false, error: currentError });
  } finally {
    await act(async () => root.unmount());
    await act(async () => { for (const request of requests) request.resolve(null); });
    container.remove();
  }
});

it('clears fewer than two selections and ignores their previous in-flight comparison', async () => {
  const { store, requests, container, root } = await setup();
  try {
    await act(async () => { store.set(compareSymbolsAtom, ['AAPL.US']); });
    await act(async () => { requests[0].resolve(success(INITIAL, 111)); });
    expect(store.get(comparisonStateAtom)).toEqual({ data: null, loading: false, error: null });
    expect(container.querySelector('[data-testid="compare-table"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    await act(async () => { for (const request of requests) request.resolve(null); });
    container.remove();
  }
});

it('does not publish an in-flight comparison after unmount', async () => {
  const { store, requests, container, root } = await setup();
  await act(async () => root.unmount());
  const previous = store.get(comparisonStateAtom);
  await act(async () => { requests[0].resolve(success(INITIAL, 111)); });
  expect(store.get(comparisonStateAtom)).toBe(previous);
  container.remove();
});

import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { Quote, StaticInfo } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient } from '../../client';
import { activeSymbolAtom } from '../../atoms/workspaceAtoms';

let restore: () => void;
let SecurityHeader: typeof import('./SecurityHeader')['SecurityHeader'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ SecurityHeader } = await import('./SecurityHeader'));
});
afterAll(() => restore());

function quote(symbol: string): Quote {
  return {
    symbol,
    lastPrice: 350,
    change: 1.5,
    changePercent: 0.43,
    volume: 1234,
    timestamp: 1,
    high: 360,
    low: 340,
    open: 345,
    prevClose: 348.5,
  };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Renders the header for `symbol` with a stubbed market channel. */
async function renderHeader(symbol: string, staticInfo: StaticInfo | null) {
  const market = {
    ...fallbackClient.market,
    getQuote: async () => ({ ok: true as const, data: quote(symbol) }),
    getStaticInfo: async () =>
      staticInfo
        ? { ok: true as const, data: staticInfo }
        : { ok: false as const, error: { code: 'NO_PROFILE', message: 'not found' } },
    getMarketStatus: async () => ({ ok: true as const, data: [] }),
  };
  const store = createStore();
  store.set(activeSymbolAtom, symbol);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <Provider store={store}>
          <FinagentClientProvider client={{ ...fallbackClient, market }}>
            <SecurityHeader />
          </FinagentClientProvider>
        </Provider>
      </TestI18n>
    );
    await new Promise((r) => setTimeout(r, 25));
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it('prices a Hong Kong instrument in HKD, never a bare $', async () => {
  const { container, cleanup } = await renderHeader('0700.HK', {
    symbol: '0700.HK',
    name: 'Tencent Holdings',
    currency: 'HKD',
  });
  try {
    const text = container.textContent ?? '';
    // last price + open/high/low/prevClose
    expect(occurrences(text, 'HK$350')).toBe(1);
    expect(occurrences(text, 'HK$')).toBe(5);
    expect(text).not.toContain('$350.00 HK');
  } finally {
    await cleanup();
  }
});

it('falls back to the routed market when the provider reports no currency', async () => {
  const { container, cleanup } = await renderHeader('600519.SH', null);
  try {
    const text = container.textContent ?? '';
    expect(occurrences(text, 'CN¥')).toBe(5);
  } finally {
    await cleanup();
  }
});

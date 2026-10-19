import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { Quote, StaticInfo } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient } from '../../client';
import { watchlistAtom } from '../../atoms';

let restore: () => void;
let Watchlist: typeof import('./Watchlist')['Watchlist'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ Watchlist } = await import('./Watchlist'));
});
afterAll(() => restore());

const QUOTE: Quote = {
  symbol: '0700.HK',
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

it('prices each row in that symbol currency', async () => {
  const staticInfo: StaticInfo = { symbol: '0700.HK', name: 'Tencent Holdings', currency: 'HKD' };
  const market = {
    ...fallbackClient.market,
    getQuote: async () => ({ ok: true as const, data: QUOTE }),
    getStaticInfo: async () => ({ ok: true as const, data: staticInfo }),
  };
  const store = createStore();
  store.set(watchlistAtom, ['0700.HK']);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <TestI18n>
          <Provider store={store}>
            <FinagentClientProvider client={{ ...fallbackClient, market }}>
              <Watchlist />
            </FinagentClientProvider>
          </Provider>
        </TestI18n>
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const row = container.querySelector('[data-testid="watchlist-row-0700.HK"]');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toContain('HK$350.00');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

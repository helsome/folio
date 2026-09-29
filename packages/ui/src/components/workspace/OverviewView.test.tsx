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
let OverviewView: typeof import('./OverviewView')['OverviewView'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ OverviewView } = await import('./OverviewView'));
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

const STATIC_INFO: StaticInfo = {
  symbol: '0700.HK',
  name: 'Tencent Holdings',
  currency: 'HKD',
};

it('formats every quote cell in the instrument currency', async () => {
  const market = {
    ...fallbackClient.market,
    getQuote: async () => ({ ok: true as const, data: QUOTE }),
    getStaticInfo: async () => ({ ok: true as const, data: STATIC_INFO }),
    getCalcIndex: async () => ({ ok: false as const, error: { code: 'NONE', message: 'n/a' } }),
    getPortfolio: async () => ({ ok: false as const, error: { code: 'NONE', message: 'n/a' } }),
    getKline: async () => ({ ok: true as const, data: [] }),
  };
  const store = createStore();
  store.set(activeSymbolAtom, '0700.HK');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <TestI18n>
          <Provider store={store}>
            <FinagentClientProvider client={{ ...fallbackClient, market }}>
              <OverviewView />
            </FinagentClientProvider>
          </Provider>
        </TestI18n>
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const text = container.textContent ?? '';
    // last / day-range (low, high) / open / prevClose — five priced cells
    expect(text.split('HK$').length - 1).toBe(5);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

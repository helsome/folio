import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { ApiResult, CalcIndex, Quote, StaticInfo, WorkspaceView } from '@finagent/core';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import { activeSymbolAtom, activeViewAtom, navSectionAtom } from '../../atoms';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';

let restoreDom: () => void;
let FinanceWorkspace: typeof import('./FinanceWorkspace')['FinanceWorkspace'];
beforeAll(async () => {
  restoreDom = installHappyDom().restore;
  ({ FinanceWorkspace } = await import('./FinanceWorkspace'));
});
afterAll(() => restoreDom());

const A = 'AAPL.US';
const B = '0700.HK';
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const quote = (symbol: string): Quote => ({ symbol, lastPrice: symbol === A ? 111.11 : 222.22,
  change: 1, changePercent: 1, volume: 123, timestamp: 1, high: 300, low: 100, open: 110, prevClose: 109 });
const calc = (symbol: string): CalcIndex => ({ symbol, pe: symbol === A ? 17.17 : 27.27 });
const info = (symbol: string): StaticInfo => ({ symbol, name: symbol, currency: symbol === A ? 'USD' : 'HKD',
  eps: symbol === A ? 1.11 : 2.22 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function mountWorkspace(view: WorkspaceView, pendingSymbol: string) {
  const pendingQuote = deferred<ApiResult<Quote>>();
  const pendingCalc = deferred<ApiResult<CalcIndex>>();
  const pendingInfo = deferred<ApiResult<StaticInfo>>();
  const calls: string[] = [];
  let pendingQuoteCalls = 0;
  const client: FinagentClient = {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getQuote: async (symbol) => {
        calls.push('quote:' + symbol);
        // The real header receives its quote first; Overview has a separate request.
        if (symbol === pendingSymbol && ++pendingQuoteCalls > 1) return pendingQuote.promise;
        return ok(quote(symbol));
      },
      getCalcIndex: async (symbol) => {
        calls.push('calc:' + symbol);
        return symbol === pendingSymbol ? pendingCalc.promise : ok(calc(symbol));
      },
      getStaticInfo: async (symbol) => {
        calls.push('info:' + symbol);
        return symbol === pendingSymbol ? pendingInfo.promise : ok(info(symbol));
      },
      getMarketStatus: async () => ok([]),
      getKline: async () => ok([]),
      getPortfolio: async () => ({ ok: false, error: { code: 'UNAVAILABLE', message: 'fixture has no position' } }),
    },
  };
  const store = createStore();
  store.set(activeSymbolAtom, A);
  store.set(activeViewAtom, view);
  store.set(navSectionAtom, 'watchlist');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<TestI18n><Provider store={store}>
    <FinagentClientProvider client={client}><FinanceWorkspace /></FinagentClientProvider>
  </Provider></TestI18n>));
  return {
    store, container, calls, pendingQuote, pendingCalc, pendingInfo,
    header: () => container.querySelector('[data-testid="security-header-symbol"]')?.textContent,
    data: () => Array.from(container.querySelectorAll('section')).map((section) => section.textContent).join(' '),
    async settle(symbol: string) {
      await act(async () => {
        pendingQuote.resolve(ok(quote(symbol)));
        pendingCalc.resolve(ok(calc(symbol)));
        pendingInfo.resolve(ok(info(symbol)));
      });
    },
    async close() { await act(async () => root.unmount()); container.remove(); },
  };
}

for (const view of ['overview', 'financials'] as const) {
  it(view + ' hides the previous instrument while the new header and data arrive independently', async () => {
    const ui = await mountWorkspace(view, B);
    try {
      expect(ui.header()).toBe(A);
      expect(ui.data()).toContain('17.17');
      expect(ui.data()).toContain('1.11');
      await act(async () => ui.store.set(activeSymbolAtom, B));
      expect(ui.header()).toBe(B);
      expect(ui.data()).not.toContain('17.17');
      expect(ui.data()).not.toContain('1.11');
      expect(ui.data()).not.toContain('111.11');
      expect(ui.data()).not.toContain('HK$111.11');
      await act(async () => ui.pendingCalc.resolve(ok(calc(B))));
      expect(ui.data()).toContain('27.27');
      expect(ui.data()).not.toContain('1.11');
      await act(async () => ui.pendingInfo.resolve(ok(info(B))));
      expect(ui.data()).toContain('2.22');
      expect(ui.data()).not.toContain('HK$111.11'); // New currency must not relabel an old quote.
      await ui.settle(B);
      expect(ui.data()).toContain('2.22');
      if (view === 'overview') expect(ui.data()).toContain('HK$222.22');
      const requestCount = ui.calls.length;
      await act(async () => ui.store.set(navSectionAtom, 'sessions'));
      expect(ui.calls.length).toBe(requestCount); // A same-symbol parent render keeps the view instance.
      expect(ui.data()).toContain('27.27');
    } finally { await ui.close(); await ui.settle(B); }
  });

  it(view + ' ignores late data from the abandoned instrument', async () => {
    const ui = await mountWorkspace(view, A);
    try {
      await act(async () => ui.store.set(activeSymbolAtom, B));
      expect(ui.header()).toBe(B);
      expect(ui.data()).toContain('27.27');
      await ui.settle(A);
      expect(ui.header()).toBe(B);
      expect(ui.data()).toContain('27.27');
      expect(ui.data()).toContain('2.22');
      expect(ui.data()).not.toContain('17.17');
      expect(ui.data()).not.toContain('111.11');
    } finally { await ui.close(); await ui.settle(A); }
  });

  it(view + ' stays empty when selection is cleared before data settles', async () => {
    const ui = await mountWorkspace(view, B);
    try {
      await act(async () => ui.store.set(activeSymbolAtom, B));
      await act(async () => ui.store.set(activeSymbolAtom, null));
      await ui.settle(B);
      expect(ui.header()).toBeUndefined();
      expect(ui.container.querySelectorAll('section').length).toBe(0);
      expect(ui.container.textContent).not.toContain('222.22');
    } finally { await ui.close(); await ui.settle(B); }
  });
}

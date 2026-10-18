import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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

const MASSIVE_QUOTE: Quote = {
  ...QUOTE,
  symbol: 'AAPL.US',
  source: { providerId: 'massive', providerName: 'Massive', delayed: true },
  provenance: {
    providerId: 'massive',
    providerName: 'Massive',
    fetchedAt: 1_710_000_000_123,
    marketTime: 1_710_000_000_000,
    delayed: true,
    stale: false,
    failoverTrail: [
      { providerId: 'longbridge', code: 'TIMEOUT', kind: 'timeout', attempts: 1, at: 1_710_000_000_100 },
    ],
  },
};

const LONGBRIDGE_QUOTE: Quote = {
  ...QUOTE,
  symbol: '0700.HK',
  source: { providerId: 'longbridge', providerName: 'Longbridge' },
  provenance: {
    providerId: 'longbridge',
    providerName: 'Longbridge',
    fetchedAt: 1_710_000_000_456,
    stale: false,
  },
};

async function renderWatchlist(market: typeof fallbackClient.market): Promise<{
  container: HTMLDivElement;
  root: import('react-dom/client').Root;
}> {
  const store = createStore();
  store.set(watchlistAtom, ['0700.HK', 'AAPL.US']);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
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
  return { container, root };
}

it('prices each row in that symbol currency', async () => {
  const staticInfo: StaticInfo = { symbol: '0700.HK', name: 'Tencent Holdings', currency: 'HKD' };
  const market = {
    ...fallbackClient.market,
    getQuote: async () => ({ ok: true as const, data: QUOTE }),
    getStaticInfo: async () => ({ ok: true as const, data: staticInfo }),
  };
  const { container, root } = await renderWatchlist(market);
  try {
    const row = container.querySelector('[data-testid="watchlist-row-0700.HK"]');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toContain('HK$350.00');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


it.each([false, true])('renders failed rows as unavailable without sample prices (allFailed=%s)', async allFailed => {
  const store = createStore();
  store.set(watchlistAtom, ['AAPL.US', 'TSLA.US']);
  const market = {
    ...fallbackClient.market,
    getQuote: async (symbol: string) => symbol === 'AAPL.US' && !allFailed
      ? { ok: true as const, data: { ...QUOTE, symbol, lastPrice: 220, source: { providerId: 'yahoo', providerName: 'Yahoo Finance', delayed: true } } }
      : { ok: false as const, error: { code: 'OFFLINE', message: 'Synthetic provider failure' } },
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<TestI18n><Provider store={store}><FinagentClientProvider client={{ ...fallbackClient, market }}><Watchlist /></FinagentClientProvider></Provider></TestI18n>);
      await new Promise(resolve => setTimeout(resolve, 25));
    });
    const tesla = container.querySelector('[data-testid="watchlist-row-TSLA.US"]');
    expect(tesla?.textContent).toContain('Quote unavailable');
    expect(tesla?.textContent).not.toContain('175.22');
    expect(tesla?.textContent).not.toContain('-2.10%');
    expect(tesla?.querySelector('[title]')?.getAttribute('title')).toContain('Synthetic provider failure');
    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull();
    const apple = container.querySelector('[data-testid="watchlist-row-AAPL.US"]');
    expect(apple?.textContent).toContain(allFailed ? 'Quote unavailable' : '$220.00');
    if (allFailed) { expect(container.textContent).not.toContain('Yahoo Finance'); expect(container.textContent).not.toContain('Updated'); }
    else expect(container.textContent).toContain('Yahoo Finance');
  } finally { await act(async () => root.unmount()); container.remove(); }

it('header names the stamped sources; row tooltip carries full provenance (#332)', async () => {
  const market = {
    ...fallbackClient.market,
    getQuote: async (symbol: string) => ({
      ok: true as const,
      data: symbol === 'AAPL.US' ? MASSIVE_QUOTE : { ...LONGBRIDGE_QUOTE, symbol },
    }),
  };
  const { container, root } = await renderWatchlist(market);
  try {
    // Header naming comes from the source stamp (joined, never hardcoded).
    const header = container.querySelector('.folio-watchlist-header')?.textContent ?? '';
    expect(header).toContain('Longbridge, Massive');
    expect(header).toContain('Delayed');
    expect(header).not.toContain('Longbridge ·');
    // The row-level tooltip still exposes the FULL routing provenance.
    const aapl = container.querySelector('[data-testid="watchlist-row-AAPL.US"]');
    const title = aapl?.querySelector('[title]')?.getAttribute('title') ?? '';
    expect(title).toContain('Source: Massive');
    expect(title).toContain('Failover: longbridge → Massive');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('never falls back to a hardcoded provider when quotes carry no source', async () => {
  const market = {
    ...fallbackClient.market,
    getQuote: async () => ({ ok: true as const, data: QUOTE }),
  };
  const { container, root } = await renderWatchlist(market);
  try {
    const header = container.querySelector('.folio-watchlist-header')?.textContent ?? '';
    expect(header).not.toContain('Longbridge');
    expect(header).not.toContain('Massive');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
});

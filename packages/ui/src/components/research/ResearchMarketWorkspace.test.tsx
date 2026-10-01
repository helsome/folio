import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { ApiResult, Quote, StaticInfo } from '@finagent/core';
import { formatDateTime } from '@finagent/i18n';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import { quoteCacheAtomFamily } from '../../atoms/quoteAtoms';

let restore: () => void;
// `./ResearchMarketWorkspace` pulls in the canvas chart (`klinecharts`), whose
// module initializer touches `window` — import it only after happy-dom is up,
// like `ResearchPanel.test.tsx` does.
let ResearchMarketWorkspace: typeof import('./ResearchMarketWorkspace')['ResearchMarketWorkspace'];

beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ ResearchMarketWorkspace } = await import('./ResearchMarketWorkspace'));
});

afterAll(() => restore());

/** Epoch SECONDS — the repo convention for `Quote.timestamp`. */
const QUOTE_TS_SECONDS = 1_732_180_800;

const US_QUOTE: Quote = {
  symbol: 'NVDA.US',
  lastPrice: 812.31,
  change: 12.34,
  changePercent: 1.54,
  volume: 1_200_000,
  timestamp: QUOTE_TS_SECONDS,
  high: 815,
  low: 800,
  open: 805,
  prevClose: 800,
};

const US_INFO: StaticInfo = { symbol: 'NVDA.US', name: 'NVIDIA Corporation', currency: 'USD' };

const HK_QUOTE: Quote = {
  symbol: '0700.HK',
  lastPrice: 350,
  change: -1.5,
  changePercent: -0.43,
  volume: 8_000_000,
  timestamp: QUOTE_TS_SECONDS,
  high: 355,
  low: 348,
  open: 352,
  prevClose: 351.5,
};

const HK_INFO: StaticInfo = { symbol: '0700.HK', name: 'Tencent Holdings', currency: 'HKD' };

function stubClient(quote: Quote, info: StaticInfo): FinagentClient {
  return {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getQuote: async () => ({ ok: true, data: quote }) as ApiResult<Quote>,
      getStaticInfo: async () => ({ ok: true, data: info }) as ApiResult<StaticInfo>,
      // Keep the chart on its empty branch so the canvas chart never mounts.
      getKline: async () =>
        ({ ok: false, error: { code: 'NO_CHART', message: 'no chart data' } }) as ApiResult<never>,
    },
  };
}

async function renderWorkspace(quote: Quote, info: StaticInfo) {
  const store = createStore();
  store.set(quoteCacheAtomFamily(quote.symbol), {
    data: quote,
    timestamp: Date.now(),
    loading: false,
    error: null,
    isDemo: false,
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <Provider store={store}>
          <FinagentClientProvider client={stubClient(quote, info)}>
            <ResearchMarketWorkspace
              symbol={quote.symbol}
              report={null}
              activeRun={null}
              loading={false}
              onStart={() => undefined}
            />
          </FinagentClientProvider>
        </Provider>
      </TestI18n>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { container, root };
}

async function textOf(quote: Quote, info: StaticInfo, selector: string): Promise<string> {
  const { container, root } = await renderWorkspace(quote, info);
  try {
    return container.querySelector(selector)?.textContent ?? '';
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

it('formats the quote price through the unified money layer', async () => {
  const price = await textOf(US_QUOTE, US_INFO, '.folio-research-price-line strong');
  // en-US: `$812.31`. The old local helper produced "812.31 USD" — the
  // "plain number + ISO code" shape `lib/money.ts` reserves for currencies it
  // cannot format, which made one USD quote render two ways in the same app.
  expect(price).toBe('$812.31');
});

it('prices a Hong Kong instrument in HKD, not "<number> HKD"', async () => {
  // The old helper rendered `350.00 HKD`; the unified layer renders `HK$350.00`,
  // matching every other quote surface in the app.
  const price = await textOf(HK_QUOTE, HK_INFO, '.folio-research-price-line strong');
  expect(price).toBe('HK$350.00');
});

it('formats the open/high/low/prev-close strip through the unified money layer', async () => {
  const strip = await textOf(HK_QUOTE, HK_INFO, '.folio-research-stat-strip');
  const money = strip.match(/HK\$[\d,.]+/g) ?? [];
  // open, high, low, prevClose — the volume/market-status cells are not money.
  expect(money).toEqual(['HK$352.00', 'HK$355.00', 'HK$348.00', 'HK$351.50']);
});

it('formats the last-updated line through the i18n date layer', async () => {
  const meta = await textOf(US_QUOTE, US_INFO, '.folio-research-market-meta');
  // The old line used `new Date(ts).toLocaleString()`, which follows the OS
  // locale instead of the app locale chosen in the UI.
  expect(meta).toContain(formatDateTime(QUOTE_TS_SECONDS * 1000));
});

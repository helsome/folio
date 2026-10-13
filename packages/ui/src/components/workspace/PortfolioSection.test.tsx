import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { I18nextProvider } from 'react-i18next';
import type { PortfolioSnapshot } from '@finagent/core';
import { createSyncI18n } from '@finagent/i18n';
import { installHappyDom } from '../../test/setupHappyDom';
import { FinagentClientProvider, fallbackClient } from '../../client';

let restore: () => void;
let PortfolioSection: typeof import('./PortfolioSection')['PortfolioSection'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ PortfolioSection } = await import('./PortfolioSection'));
});
afterAll(() => restore());

/**
 * Account totals present, holdings missing. `portfolioFailureFromSnapshot`
 * classifies this as `partial` and keeps the snapshot, so this is a failure
 * state that actually reaches the renderer (spec §19: one distinct state per
 * kind, never one generic "portfolio unavailable" line).
 */
const PARTIAL: PortfolioSnapshot = {
  baseCurrency: 'USD',
  accounts: [],
  holdings: [],
  totalAssets: 100,
  fetchedAt: 1,
};

async function renderPartial(locale: 'en-US' | 'zh-CN'): Promise<string> {
  const i18n = createSyncI18n({ locale });
  const client = {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getPortfolio: async () => ({ ok: true as const, data: PARTIAL }),
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <Provider store={createStore()}>
          <FinagentClientProvider client={client}>
            <PortfolioSection />
          </FinagentClientProvider>
        </Provider>
      </I18nextProvider>
    );
  });
  const text = container.textContent ?? '';
  await act(async () => {
    root.unmount();
  });
  container.remove();
  return text;
}

describe('portfolio failure detail follows the UI locale', () => {
  it('renders the partial detail in zh-CN instead of the English table sentence', async () => {
    const zh = await renderPartial('zh-CN');
    expect(zh).toContain('账户总额已加载，但无法读取持仓。');
    expect(zh).not.toContain('Account totals loaded');
  });

  it('keeps the English detail for en-US', async () => {
    const en = await renderPartial('en-US');
    expect(en).toContain('Account totals loaded, but holdings could not be read.');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { I18nextProvider } from 'react-i18next';
import type { PortfolioSnapshot } from '@finagent/core';
import { createSyncI18n } from '@finagent/i18n';
import { installHappyDom } from '../../test/setupHappyDom';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import type { PortfolioImportElectronApi } from '../../client/portfolioImport';

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

async function renderPortfolio(
  locale: 'en-US' | 'zh-CN',
  getPortfolio: FinagentClient['market']['getPortfolio'] = async () => ({ ok: true, data: PARTIAL }),
  inspect?: (container: HTMLDivElement) => Promise<void>,
): Promise<string> {
  const i18n = createSyncI18n({ locale });
  const client = {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getPortfolio,
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
  try {
    await inspect?.(container);
    return container.textContent ?? '';
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

describe('portfolio failure detail follows the UI locale', () => {
  it('renders the partial detail in zh-CN instead of the English table sentence', async () => {
    const zh = await renderPortfolio('zh-CN');
    expect(zh).toContain('账户总额已加载，但无法读取持仓。');
    expect(zh).not.toContain('Account totals loaded');
  });

  it('keeps the English detail for en-US', async () => {
    const en = await renderPortfolio('en-US');
    expect(en).toContain('Account totals loaded, but holdings could not be read.');
  });

  it.each(['en-US', 'zh-CN'] as const)('renders classified IPC failures in %s through the actual fetch path', async (locale) => {
    const t = createSyncI18n({ locale }).t;
    for (const [code, key] of [
      ['PARSE_FAILURE', 'parseError'],
      ['TIMEOUT', 'timeout'],
      ['PROVIDER_UNAVAILABLE', 'providerError'],
    ]) {
      const text = await renderPortfolio(locale, async () => ({ ok: false, error: { code, message: '' } }));
      expect(text).toContain(t(`portfolio.failure.${key}`));
      expect(text).toContain(t(`portfolio.failureDetail.${key}`));
      expect(text).not.toContain('AAPL.US');
    }
  });

  it('keeps manual account navigation and import available while the broker fails', async () => {
    const host = window as unknown as { electronAPI?: PortfolioImportElectronApi };
    const previous = host.electronAPI;
    host.electronAPI = { portfolioImport: { listManual: async () => ({
      ok: true,
      data: [{ id: 'local', name: 'Offline account', currency: 'USD', updatedAt: 1,
        holdings: [{ symbol: 'MANUAL.US', name: 'Manual holding', quantity: 2 }] }],
    }) } };
    try {
      await renderPortfolio('en-US', async () => ({
        ok: false, error: { code: 'TIMEOUT', message: 'Request timed out' },
      }), async (container) => {
        const t = createSyncI18n({ locale: 'en-US' }).t;
        for (const value of ['manual:local', '', 'manual:local', '']) {
          const select = container.querySelector('select');
          expect(select).not.toBeNull();
          await act(async () => {
            select!.value = value;
            select!.dispatchEvent(new Event('change', { bubbles: true }));
          });
          if (value) {
            expect(container.textContent).toContain('MANUAL.US');
            expect(container.textContent).not.toContain(t('portfolio.failureDetail.timeout'));
          } else {
            expect(container.textContent).toContain(t('portfolio.failureDetail.timeout'));
          }
        }
        const button = Array.from(container.querySelectorAll('button'))
          .find((node) => node.textContent === t('portfolio.importButton'));
        expect(button).toBeDefined();
        await act(async () => { button!.click(); });
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      });
    } finally {
      if (previous === undefined) delete host.electronAPI;
      else host.electronAPI = previous;
    }
  });
});

import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { Run } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { fallbackClient, FinagentClientProvider } from '../../client';
import { watchlistAtom } from '../../atoms/quoteAtoms';
import { watchlistContextEnabledAtomFamily } from '../../atoms/watchlistContextAtoms';
import { WatchlistContextControl } from './WatchlistContextControl';

let restore: () => void;
beforeAll(() => { restore = installHappyDom().restore; });
afterAll(() => restore());

it('keeps opt-in local to a conversation and displays persisted snapshots instead of current symbols', async () => {
  const store = createStore();
  store.set(watchlistAtom, ['MSFT.US']);
  const historical: Run = {
    id: 'r1', sessionId: 's1', status: 'completed', input: 'Original question', startedAt: 1,
    watchlistContext: {
      schemaVersion: 1, sourceId: 'default', capturedAt: 1, version: 'v1',
      instruments: [{ instrumentId: 'XNAS:AAPL', symbol: 'AAPL' }],
    },
  };
  const client = {
    ...fallbackClient,
    kernel: {
      ...fallbackClient.kernel,
      listRuns: async (sessionId: string) => ({ ok: true as const, data: sessionId === 's1' ? [historical] : [] }),
    },
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = async (sessionId: string) => {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <Provider store={store}>
            <FinagentClientProvider client={client}>
              <WatchlistContextControl sessionId={sessionId} isRunning={false} />
            </FinagentClientProvider>
          </Provider>
        </I18nextProvider>
      );
    });
  };
  try {
    await render('s1');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(false);
    expect(container.querySelector('ul')?.textContent).toContain('AAPL');
    expect(container.querySelector('ul')?.textContent).not.toContain('MSFT');
    act(() => checkbox?.click());
    expect(store.get(watchlistContextEnabledAtomFamily('s1'))).toBe(true);
    expect(container.textContent).toContain('MSFT.US');
    await render('s2');
    expect(container.querySelector<HTMLInputElement>('input')?.checked).toBe(false);
    expect(container.textContent).not.toContain('Original question');
    await render('s1');
    expect(container.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

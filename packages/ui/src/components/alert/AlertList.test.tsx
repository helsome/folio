import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { createSyncI18n } from '@finagent/i18n';
import type { AlertRule } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client';
import { alertStateAtom } from '../../atoms';
import { AlertList } from './AlertList';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/**
 * The status filter offers "all | active | paused". The two narrower options
 * already use the locale layer (`alerts.status.active` / `alerts.status.paused`)
 * while the first one was a literal `All`, so a zh-CN user saw a mixed-language
 * dropdown. The shared key already exists: `common.all`.
 */
it('renders the status filter "all" option from the shared locale key', async () => {
  const zh = createSyncI18n({ locale: 'zh-CN' });
  const expected = zh.t('common.all');
  // Pin the resource so this assertion cannot silently pass if the key moves.
  expect(expected).toBe('全部');

  const store = createStore();
  store.set(alertStateAtom, { rules: [], events: [], loading: false, error: null });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client: FinagentClient = { ...fallbackClient };

  await act(async () => {
    root.render(
      withI18n(
        <Provider store={store}>
          <FinagentClientProvider client={client}>
            <AlertList />
          </FinagentClientProvider>
        </Provider>,
        'zh-CN'
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  try {
    const option = container.querySelector('select option[value="all"]');
    expect(option?.textContent).toBe(expected);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

async function flushAsync(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * #328: a pause/delete that fails to persist must not leave the card showing
 * the optimistic state. The atom rolls back and the list explains why.
 */
it('restores the previous state and explains a failed pause', async () => {
  const store = createStore();
  const rule: AlertRule = {
    id: 'r1',
    createdAt: 0,
    enabled: true,
    cooldownMinutes: 30,
    symbol: 'AAPL.US',
    type: 'price_above',
    targetPrice: 150,
  };
  store.set(alertStateAtom, { rules: [rule], events: [], loading: false, error: null });

  const client = {
    ...fallbackClient,
    alerts: {
      loadRules: async () => ({ ok: true as const, data: [rule] }),
      listEvents: async () => ({ ok: true as const, data: [] }),
      saveRules: async () => ({ ok: false as const, error: { code: 'STORE_WRITE_FAILED', message: 'disk full' } }),
      onTriggered: () => () => undefined,
    },
  } as unknown as FinagentClient;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      withI18n(
        <Provider store={store}>
          <FinagentClientProvider client={client}>
            <AlertList />
          </FinagentClientProvider>
        </Provider>,
        'en-US'
      )
    );
  });
  await flushAsync();

  const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Disable alert"]');
  expect(toggle).not.toBeNull();
  await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flushAsync();

  expect(store.get(alertStateAtom).rules[0].enabled).toBe(true);
  expect(container.querySelector('[data-testid="alerts-persist-error"]')?.textContent).toContain(
    'The alert status could not be saved'
  );

  await act(async () => root.unmount());
  container.remove();
});

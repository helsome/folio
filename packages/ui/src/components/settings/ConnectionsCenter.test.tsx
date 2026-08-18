import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResult } from '@finagent/core';
import {
  fallbackClient,
  FinagentClientProvider,
  type FinagentClient,
} from '../../client';
import type { ConnectionEntry } from '../../client/connections';
import { installHappyDom } from '../../test/setupHappyDom';
import { initI18nForSettingsTests } from '../../test/i18nSettings';
import { ConnectionsCenter } from './ConnectionsCenter';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  initI18nForSettingsTests();
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const ENTRY: ConnectionEntry = {
  providerId: 'longbridge',
  kind: 'broker-account',
  name: 'Longbridge',
  status: 'connected',
  health: { status: 'connected', lastCheck: 123 },
  coverage: {
    providerId: 'longbridge',
    capabilities: ['market.quote', 'portfolio.summary'],
    markets: [{ id: 'US', name: 'United States' }],
  },
  configurable: false,
  configured: false,
  hasAccount: true,
  accountLabel: 'US Margin (D123)',
  error: null,
};

function clientWith(overrides: Partial<FinagentClient['connections']> = {}): FinagentClient {
  return {
    ...fallbackClient,
    connections: {
      list: async () => ({ ok: true, data: [ENTRY] }),
      connect: async () => ({ ok: true, data: { status: 'connecting', verificationUrl: 'https://v' } }),
      cancelConnect: async () => ({ ok: true, data: undefined }),
      disconnect: async () => ({ ok: true, data: null }),
      test: async () => ({ ok: true, data: { status: 'connected', lastCheck: Date.now() } }),
      setConfig: async () => ({ ok: true, data: ENTRY }),
      coverage: async () => ({ ok: true, data: [ENTRY.coverage!] }),
      onChanged: () => () => undefined,
      ...overrides,
    },
  };
}

async function render(client: FinagentClient) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FinagentClientProvider client={client}>
        <ConnectionsCenter />
      </FinagentClientProvider>
    );
  });
  return { container, root };
}

describe('ConnectionsCenter', () => {
  it('renders the capability matrix from coverage', async () => {
    const { container } = await render(clientWith());
    const matrix = container.querySelector('[data-testid="capability-matrix"]');
    expect(matrix).not.toBeNull();
    const cells = matrix?.querySelectorAll('tbody td');
    const hasCheck = cells ? Array.from(cells).some((cell) => cell.textContent === '✓') : false;
    expect(hasCheck).toBe(true);
  });

  it('shows a notice when the channel is not wired', async () => {
    const client: FinagentClient = { ...fallbackClient, connections: undefined };
    const { container } = await render(client);
    expect(container.textContent).toContain("aren't wired");
  });

  it('surfaces a visible error banner when a card action fails', async () => {
    const client = clientWith({
      test: async () => ({ ok: false, error: { code: 'TIMEOUT', message: 'timed out' } }),
    });
    const { container } = await render(client);

    const testButton = container.querySelector<HTMLButtonElement>('[data-testid="test-longbridge"]');
    expect(testButton).not.toBeNull();

    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const banner = container.querySelector<HTMLElement>('[data-testid="connection-error-longbridge"]');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.textContent).toContain('timed out');
  });
});

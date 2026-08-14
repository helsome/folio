import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResult } from '@finagent/core';
import {
  fallbackClient,
  FinagentClientProvider,
  type FinagentClient,
  type SkillListItem,
} from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { SkillsView } from './SkillsView';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FIXTURE: SkillListItem = {
  id: 'longbridge',
  name: 'Longbridge',
  keywords: ['quote', 'kline'],
  enabled: true,
  description: 'Market data via Longbridge CLI',
  riskLevel: 'read_only',
  tier: 'read',
};

function clientWith(overrides: Partial<FinagentClient['skills']>): FinagentClient {
  return {
    ...fallbackClient,
    skills: {
      list: async () => ({ ok: true, data: [FIXTURE] }),
      setEnabled: async () => ({ ok: true, data: undefined }),
      listResources: async () => ({ ok: true, data: [] }),
      readResource: async () => ({ ok: true, data: '# sample' }),
      readiness: async () => ({ ok: true, data: [] }),
      ...overrides,
    },
  };
}

async function renderSkillsView(client: FinagentClient) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FinagentClientProvider client={client}>
        <SkillsView />
      </FinagentClientProvider>
    );
  });
  return { container, root };
}

function switchIn(container: HTMLElement): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
  if (!toggle) throw new Error('switch not found');
  return toggle;
}

describe('SkillsView toggle', () => {
  it('optimistically flips, rolls back, and shows an inline error on IPC failure', async () => {
    const pending = deferred<ApiResult<void>>();
    const client = clientWith({ setEnabled: () => pending.promise });

    const { container } = await renderSkillsView(client);

    const toggle = switchIn(container);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Click → optimistic flip + in-flight state before the IPC resolves.
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-busy')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(true);

    // IPC fails → rollback + visible inline error.
    await act(async () => {
      pending.resolve({ ok: false, error: { code: 'IPC_FAIL', message: 'Simulated failure' } });
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-busy')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(false);

    const error = container.querySelector<HTMLElement>('[data-testid="skill-toggle-error-longbridge"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Simulated failure');
  });

  it('persists the optimistic flip when the IPC succeeds', async () => {
    const client = clientWith({ setEnabled: async () => ({ ok: true, data: undefined }) });
    const { container } = await renderSkillsView(client);

    const toggle = switchIn(container);
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('[data-testid="skill-toggle-error-longbridge"]')).toBeNull();
  });
});

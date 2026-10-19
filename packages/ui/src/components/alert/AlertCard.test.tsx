import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AlertRule } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';

let restore: () => void;
let AlertCard: typeof import('./AlertCard')['AlertCard'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ AlertCard } = await import('./AlertCard'));
});
afterAll(() => restore());

function priceRule(symbol: string, targetPrice = 350): AlertRule {
  return {
    id: 'r1',
    createdAt: 1,
    enabled: true,
    cooldownMinutes: 30,
    symbol,
    type: 'price_above',
    targetPrice,
  };
}

async function renderCard(rule: AlertRule) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <AlertCard rule={rule} />
      </TestI18n>
    );
    await new Promise((r) => setTimeout(r, 5));
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it('states the currency of a Hong Kong price alert', async () => {
  const { container, cleanup } = await renderCard(priceRule('0700.HK'));
  try {
    expect(container.textContent ?? '').toContain('Above HK$350.00');
  } finally {
    await cleanup();
  }
});

it('states the currency of a mainland price alert', async () => {
  const { container, cleanup } = await renderCard(priceRule('600519.SH'));
  try {
    expect(container.textContent ?? '').toContain('Above CN¥350.00');
  } finally {
    await cleanup();
  }
});

it('keeps a US price alert in USD', async () => {
  const { container, cleanup } = await renderCard(priceRule('AAPL.US'));
  try {
    expect(container.textContent ?? '').toContain('Above $350.00');
  } finally {
    await cleanup();
  }
});

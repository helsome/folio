import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quote } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';

let restore: () => void;
let StockCard: typeof import('./StockCard')['StockCard'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ StockCard } = await import('./StockCard'));
});
afterAll(() => restore());

function quote(symbol: string): Quote {
  return {
    symbol,
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
}

async function renderCard(symbol: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <StockCard quote={quote(symbol)} />
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

it('prices a Hong Kong tile in HKD instead of a hardcoded $', async () => {
  const { container, cleanup } = await renderCard('0700.HK');
  try {
    const text = container.textContent ?? '';
    // last price + the H:/L: line
    expect(text.split('HK$').length - 1).toBe(3);
    expect(text).toContain('HK$350.00');
  } finally {
    await cleanup();
  }
});

it('keeps a US tile in USD', async () => {
  const { container, cleanup } = await renderCard('AAPL.US');
  try {
    expect(container.textContent ?? '').toContain('$350.00');
  } finally {
    await cleanup();
  }
});

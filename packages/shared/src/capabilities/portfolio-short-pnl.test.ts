import { describe, expect, it } from 'bun:test';
import type { PortfolioSnapshot } from '@finagent/core';
import { parsePortfolioResponse } from '@finagent/longbridge-tools';
import type { CapabilityFetchers } from './fetchers.ts';
import { CapabilityExecutor } from './executor.ts';
import { createPortfolioSummaryCapability } from './manifests/portfolio-summary.ts';

describe('portfolio.summary computed P&L direction', () => {
  it.each([
    { quantity: -10, price: 120, amount: -200, percent: -20 },
    { quantity: -10, price: 80, amount: 200, percent: 20 },
    { quantity: -10, price: 100, amount: 0, percent: 0 },
    { quantity: -0.25, price: 120, amount: -5, percent: -20 },
    { quantity: -0.25, price: 80, amount: 5, percent: 20 },
    { quantity: 10, price: 120, amount: 200, percent: 20 },
    { quantity: 10, price: 80, amount: -200, percent: -20 },
    { quantity: 0, price: 120, amount: 0, percent: 20 },
    { quantity: undefined, price: 120, amount: undefined, percent: 20 },
  ])('normalizes quantity $quantity at price $price through the real parser and capability', async (sample) => {
    // Deliberately fake positions: this test never reads a brokerage account.
    const wire = JSON.stringify({
      overview: { currency: 'USD', total_asset: '10000' },
      holdings: [{
        symbol: 'AAPL.US', name: 'Synthetic position', currency: 'USD',
        quantity: sample.quantity === undefined ? undefined : String(sample.quantity),
        cost_price: '100', market_price: String(sample.price),
      }],
    });
    const snapshot = parsePortfolioResponse(wire);
    const fetchers = { getPortfolio: async () => snapshot } as unknown as CapabilityFetchers;
    const outcome = await new CapabilityExecutor().run(createPortfolioSummaryCapability(fetchers), {});

    expect(outcome.record.status).toBe('success');
    // The executor erases capability generics; this is the real manifest's output contract.
    const holding = (outcome.result?.data as PortfolioSnapshot | undefined)?.holdings[0];
    expect(holding?.quantity).toBe(sample.quantity);
    if (sample.amount === undefined) expect(holding?.unrealizedPnL).toBeUndefined();
    else expect(holding?.unrealizedPnL).toBeCloseTo(sample.amount);
    expect(holding?.unrealizedPnLPercent).toBe(sample.percent);
    expect(outcome.result?.summary).toContain(`(${sample.percent.toFixed(2)}%)`);
    expect(JSON.parse(JSON.stringify(outcome.result?.data)).holdings[0].unrealizedPnLPercent)
      .toBe(sample.percent);
  });
});

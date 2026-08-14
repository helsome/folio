import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'bun:test';
import type { Comparison, FinanceCapability } from '@finagent/core';
import { defineCapability } from '../capabilities/define.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { buildComparison } from './service.ts';

type Bars = Array<{ timestamp: number; close: number }>;

function makeCap(
  id: string,
  toolName: string,
  execute: (symbol: string) => unknown
): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName,
    inputSchema: Type.Object({ symbol: Type.String() }),
    async execute(input) {
      const symbol = (input as { symbol: string }).symbol;
      return {
        data: execute(symbol),
        provenance: { provider: 'test', fetchedAt: 1, stale: false },
        summary: `${id} ok`,
      };
    },
  });
}

/** 260 ascending daily bars, close = 100 + i. */
function defaultBars(): Bars {
  return Array.from({ length: 260 }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 86_400,
    close: 100 + i,
  }));
}

function barsWith(overrides: Record<number, number>): Bars {
  const bars = defaultBars();
  for (const [index, close] of Object.entries(overrides)) {
    bars[Number(index)] = { ...bars[Number(index)], close };
  }
  return bars;
}

const FULL_DATA = {
  'market.quote': { symbol: 'AAPL.US', lastPrice: 100.5 },
  'company.valuation': { symbol: 'AAPL.US', pe: 34.12, pb: 27.86, totalMarketValue: 5.445e12 },
  'company.financials': { revenueGrowth: 15.2, grossMargin: 62.5, roe: 45.1 },
  'company.dividends': { dividendYield: 0.12 },
  'market.kline': defaultBars(),
  'company.ratings': { consensus: 'strong_buy' },
};

function fullRegistry() {
  return createCapabilityRegistry([
    makeCap('market.quote', 'get_quote', () => FULL_DATA['market.quote']),
    makeCap('company.valuation', 'get_valuation', () => FULL_DATA['company.valuation']),
    makeCap('company.financials', 'get_financials', () => FULL_DATA['company.financials']),
    makeCap('company.dividends', 'get_dividends', () => FULL_DATA['company.dividends']),
    makeCap('market.kline', 'get_kline', () => FULL_DATA['market.kline']),
    makeCap('company.ratings', 'get_ratings', () => FULL_DATA['company.ratings']),
  ]);
}

function cell(comparison: Comparison, metric: string, symbol: string) {
  const row = comparison.rows.find((r) => r.metric === metric);
  return row?.cells[symbol];
}

function expectedReturn(bars: Bars, days: number): number {
  const latest = bars[bars.length - 1].close;
  const base = bars[bars.length - 1 - days].close;
  return ((latest - base) / base) * 100;
}

describe('buildComparison', () => {
  it('builds a full table with correctly formatted cells', async () => {
    const comparison = await buildComparison(['AAPL.US', 'MSFT.US'], fullRegistry(), { now: () => 1 });

    expect(comparison.symbols).toEqual(['AAPL.US', 'MSFT.US']);
    expect(comparison.errors).toEqual({});

    expect(cell(comparison, 'Price', 'AAPL.US')).toMatchObject({ value: 100.5, display: '$100.50', missing: false });
    expect(cell(comparison, 'Market Cap', 'AAPL.US')?.display).toBe('$5.45T');
    expect(cell(comparison, 'PE', 'AAPL.US')?.display).toBe('34.12');
    expect(cell(comparison, 'PB', 'AAPL.US')?.display).toBe('27.86');
    expect(cell(comparison, 'Revenue Growth', 'AAPL.US')?.display).toBe('15.2%');
    expect(cell(comparison, 'Gross Margin', 'AAPL.US')?.display).toBe('62.5%');
    expect(cell(comparison, 'ROE', 'AAPL.US')?.display).toBe('45.1%');
    expect(cell(comparison, 'Dividend Yield', 'AAPL.US')?.display).toBe('0.1%');
    expect(cell(comparison, 'Analyst Rating', 'AAPL.US')?.display).toBe('Buy');

    const bars = FULL_DATA['market.kline'] as Bars;
    expect(cell(comparison, '1M Return', 'AAPL.US')?.value).toBeCloseTo(expectedReturn(bars, 21), 6);
    expect(cell(comparison, '3M Return', 'AAPL.US')?.value).toBeCloseTo(expectedReturn(bars, 63), 6);
    expect(cell(comparison, '1Y Return', 'AAPL.US')?.value).toBeCloseTo(expectedReturn(bars, 252), 6);
    // 1M ≈ +6.2% and 3M ≈ +21.3%: same sign, |1M| >= 5% → 'Strong'.
    expect(cell(comparison, 'Momentum', 'AAPL.US')?.display).toBe('Strong');
  });

  it('renders missing cells as — when capabilities are absent', async () => {
    const registry = createCapabilityRegistry([
      makeCap('market.quote', 'get_quote', () => FULL_DATA['market.quote']),
      makeCap('market.kline', 'get_kline', () => FULL_DATA['market.kline']),
    ]);

    const comparison = await buildComparison(['AAPL.US'], registry, { now: () => 1 });

    expect(cell(comparison, 'Price', 'AAPL.US')?.missing).toBe(false);
    expect(cell(comparison, 'PE', 'AAPL.US')).toEqual({ missing: true, display: '—' });
    expect(cell(comparison, 'Revenue Growth', 'AAPL.US')?.display).toBe('—');
    expect(cell(comparison, 'Dividend Yield', 'AAPL.US')?.display).toBe('—');
    expect(cell(comparison, 'Analyst Rating', 'AAPL.US')?.display).toBe('—');
  });

  it('records per-symbol errors and leaves other cells intact', async () => {
    const registry = createCapabilityRegistry([
      makeCap('market.quote', 'get_quote', (symbol) => {
        if (symbol === 'BROKEN.US') throw new Error('quote down');
        return FULL_DATA['market.quote'];
      }),
      makeCap('company.valuation', 'get_valuation', () => FULL_DATA['company.valuation']),
    ]);

    const comparison = await buildComparison(['AAPL.US', 'BROKEN.US'], registry, { now: () => 1 });

    expect(comparison.errors['BROKEN.US']).toBe('quote down');
    expect(comparison.errors['AAPL.US']).toBeUndefined();
    expect(cell(comparison, 'Price', 'BROKEN.US')?.missing).toBe(true);
    expect(cell(comparison, 'Price', 'AAPL.US')?.missing).toBe(false);
    // The failed quote does not poison the valuation row for the same symbol.
    expect(cell(comparison, 'PE', 'BROKEN.US')?.display).toBe('34.12');
  });

  it('classifies momentum as Weak when both returns are small and same-sign', async () => {
    // close[238]=101, close[259]=103 → 1M ≈ +1.98%; close[196]=100 → 3M = +3%.
    const bars = barsWith({ 238: 101, 259: 103, 196: 100 });
    const registry = createCapabilityRegistry([
      makeCap('market.kline', 'get_kline', () => bars),
    ]);

    const comparison = await buildComparison(['AAPL.US'], registry, { now: () => 1 });

    expect(cell(comparison, 'Momentum', 'AAPL.US')?.display).toBe('Weak');
  });

  it('classifies momentum as Mixed when 1M and 3M returns diverge in sign', async () => {
    // close[238]=100, close[259]=150 → 1M = +50%; close[196]=200 → 3M = -25%.
    const bars = barsWith({ 238: 100, 259: 150, 196: 200 });
    const registry = createCapabilityRegistry([
      makeCap('market.kline', 'get_kline', () => bars),
    ]);

    const comparison = await buildComparison(['AAPL.US'], registry, { now: () => 1 });

    expect(cell(comparison, 'Momentum', 'AAPL.US')?.display).toBe('Mixed');
  });

  it('leaves the Momentum cell missing when klines are absent', async () => {
    const registry = createCapabilityRegistry([
      makeCap('market.quote', 'get_quote', () => FULL_DATA['market.quote']),
    ]);

    const comparison = await buildComparison(['AAPL.US'], registry, { now: () => 1 });

    expect(cell(comparison, 'Momentum', 'AAPL.US')?.display).toBe('—');
  });

  it('marks a 1Y return missing when there are not enough bars', async () => {
    const short = defaultBars().slice(0, 10);
    const registry = createCapabilityRegistry([
      makeCap('market.kline', 'get_kline', () => short),
    ]);

    const comparison = await buildComparison(['AAPL.US'], registry, { now: () => 1 });

    expect(cell(comparison, '1M Return', 'AAPL.US')?.missing).toBe(true);
    expect(cell(comparison, '1Y Return', 'AAPL.US')?.missing).toBe(true);
  });
});

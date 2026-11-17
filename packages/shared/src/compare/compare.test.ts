import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'bun:test';
import type { Comparison, FinanceCapability } from '@finagent/core';
import { parseCalcIndexResponse, parseDividendResponse, parseFinancialReportResponse } from '@finagent/longbridge-tools';
import { loadFixtureText } from '../../../longbridge-tools/src/testing/load-fixture.ts';
import { defineCapability } from '../capabilities/define.ts';
import { defaultCapabilityFetchers } from '../capabilities/fetchers.ts';
import { createCompanyValuationCapability } from '../capabilities/manifests/company-valuation.ts';
import { createCompanyDividendsCapability, createCompanyFinancialsCapability } from '../capabilities/manifests/phase-two.ts';
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
  'company.valuation': { symbol: 'AAPL.US', pe: 34.12, pb: 27.86, dpsRate: 0.12, totalMarketValue: 5.445e12 },
  'company.financials': { revenueGrowth: 15.2, grossMargin: 62.5, roe: 45.1 },
  'company.dividends': [],
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
  it('reads financial metrics through the real CLI parser and capability contract', async () => {
    const report = parseFinancialReportResponse(loadFixtureText('financial-report'), 'NVDA.US');
    const fetchers = { ...defaultCapabilityFetchers, getFinancialReport: async () => report };
    const registry = createCapabilityRegistry([createCompanyFinancialsCapability(fetchers)]);

    const comparison = await buildComparison(['NVDA.US'], registry);

    expect(comparison.errors).toEqual({});
    expect(cell(comparison, 'Revenue Growth', 'NVDA.US')).toEqual({
      value: 85.22763378875221, display: '85.2%', missing: false,
    });
    expect(cell(comparison, 'Gross Margin', 'NVDA.US')).toEqual({
      value: 74.9335, display: '74.9%', missing: false,
    });
    expect(cell(comparison, 'ROE', 'NVDA.US')).toEqual({
      value: 132.2592, display: '132.3%', missing: false,
    });
  });

  for (const value of [0, 12.5]) {
    it('reads the latest financial period by fpEnd and preserves ' + value + ' percent', async () => {
      const registry = createCapabilityRegistry([
        makeCap('company.financials', 'get_financials', () => ({
          revenueGrowth: 99, grossMargin: 99, roe: 99,
          statements: { IS: { indicators: [{ accounts: [
            { field: 'OperatingRevenue', values: [
              { fpEnd: 100, value: 500, yoy: 99 },
              { fpEnd: 300, value: 1000, yoy: String(value) },
              { fpEnd: 200, value: 750, yoy: 99 },
            ] },
            ...['GrossMgn', 'ROE'].map((field) => ({ field, values: [
              { fpEnd: 100, value: 99 },
              { fpEnd: 300, value },
              { fpEnd: 200, value: 99 },
            ] })),
          ] }] } },
        })),
      ]);

      const comparison = await buildComparison(['NVDA.US'], registry);

      for (const metric of ['Revenue Growth', 'Gross Margin', 'ROE']) {
        expect(cell(comparison, metric, 'NVDA.US')).toEqual({
          value, display: value.toFixed(1) + '%', missing: false,
        });
      }
    });
  }

  for (const value of [undefined, NaN, Infinity, -Infinity]) {
    it('keeps missing latest financial values without using old periods or inferring YoY: ' + String(value), async () => {
      const registry = createCapabilityRegistry([
        makeCap('company.financials', 'get_financials', () => ({
          revenueGrowth: 99, grossMargin: 99, roe: 99,
          statements: { IS: { indicators: [{ accounts: [
            { field: 'OperatingRevenue', values: [
              { fpEnd: 100, value: 500, yoy: 99 },
              { fpEnd: 300, value: 1000, yoy: value },
              { fpEnd: 200, value: 750, yoy: 99 },
            ] },
            ...['GrossMgn', 'ROE'].map((field) => ({ field, values: [
              { fpEnd: 100, value: 99 },
              { fpEnd: 300, value },
              { fpEnd: 200, value: 99 },
            ] })),
          ] }] } },
        })),
      ]);

      const comparison = await buildComparison(['NVDA.US'], registry);

      for (const metric of ['Revenue Growth', 'Gross Margin', 'ROE']) {
        expect(cell(comparison, metric, 'NVDA.US')).toEqual({ missing: true, display: '—' });
      }
    });
  }

  it('preserves zero-valued legacy flat financial metrics', async () => {
    const registry = createCapabilityRegistry([
      makeCap('company.financials', 'get_financials', () => ({ revenueGrowth: 0, grossMargin: 0, roe: 0 })),
    ]);

    const comparison = await buildComparison(['NVDA.US'], registry);

    for (const metric of ['Revenue Growth', 'Gross Margin', 'ROE']) {
      expect(cell(comparison, metric, 'NVDA.US')).toEqual({ value: 0, display: '0.0%', missing: false });
    }
  });

  it('reads dividend yield through the real CLI parser and capability contracts', async () => {
    const index = parseCalcIndexResponse(loadFixtureText('calc-index'));
    const dividends = parseDividendResponse(loadFixtureText('dividend'));
    const fetchers = {
      ...defaultCapabilityFetchers,
      getCalcIndex: async () => index,
      getDividends: async () => dividends,
    };
    const registry = createCapabilityRegistry([
      createCompanyValuationCapability(fetchers),
      createCompanyDividendsCapability(fetchers),
    ]);

    const comparison = await buildComparison(['NVDA.US'], registry);

    expect(dividends.length).toBeGreaterThan(0);
    expect(comparison.errors).toEqual({});
    expect(cell(comparison, 'Dividend Yield', 'NVDA.US')).toEqual({
      value: 0.12, display: '0.1%', missing: false,
    });
  });

  for (const { value, display } of [
    { value: 0, display: '0.0%' },
    { value: 2.5, display: '2.5%' },
  ]) {
    it('prefers valuation dividend yield ' + value + ' without changing its percent unit', async () => {
      const registry = createCapabilityRegistry([
        makeCap('company.valuation', 'get_valuation', () => ({ dpsRate: value })),
        makeCap('company.dividends', 'get_dividends', () => ({ dividendYield: 9.9 })),
      ]);

      const comparison = await buildComparison(['NVDA.US'], registry);

      expect(cell(comparison, 'Dividend Yield', 'NVDA.US')).toEqual({ value, display, missing: false });
    });
  }

  it('uses valuation dividend yield without a dividend-history capability', async () => {
    const registry = createCapabilityRegistry([
      makeCap('company.valuation', 'get_valuation', () => ({ dpsRate: 2.5 })),
    ]);

    const comparison = await buildComparison(['NVDA.US'], registry);

    expect(comparison.errors).toEqual({});
    expect(cell(comparison, 'Dividend Yield', 'NVDA.US')).toEqual({
      value: 2.5, display: '2.5%', missing: false,
    });
  });

  for (const value of [undefined, NaN, Infinity, -Infinity]) {
    it('keeps dividend yield missing for invalid valuation ' + String(value), async () => {
      const registry = createCapabilityRegistry([
        makeCap('company.valuation', 'get_valuation', () => ({ dpsRate: value })),
        makeCap('company.dividends', 'get_dividends', () => parseDividendResponse(loadFixtureText('dividend'))),
      ]);

      const comparison = await buildComparison(['NVDA.US'], registry);

      expect(cell(comparison, 'Dividend Yield', 'NVDA.US')).toEqual({ missing: true, display: '—' });
    });
  }

  it('preserves the existing explicit dividend-yield fallback', async () => {
    const registry = createCapabilityRegistry([
      makeCap('company.dividends', 'get_dividends', () => ({ dividendYield: 0.12 })),
    ]);

    const comparison = await buildComparison(['NVDA.US'], registry);

    expect(cell(comparison, 'Dividend Yield', 'NVDA.US')).toEqual({
      value: 0.12, display: '0.1%', missing: false,
    });
  });

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

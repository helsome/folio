import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, spyOn } from 'bun:test';
import type { FinancialReport } from '@finagent/core';
import { defaultCapabilityFetchers } from '../capabilities/fetchers.ts';
import { createCompanyFinancialsCapability } from '../capabilities/manifests/phase-two.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { MassiveFinancialDataProvider } from '../providers/massive/adapter.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ScreeningRunRepository } from './repository.ts';
import { ScreeningService } from './service.ts';
import { extractFinancialMetrics, getScreeningStrategy, type StrategyContext } from './strategies.ts';

function report(yoy?: string): FinancialReport {
  return {
    symbol: 'AAPL.US', report: 'qf',
    statements: { IS: { indicators: [{ title: 'IS', accounts: [{
      field: 'OperatingRevenue', name: 'Revenue', values: [
        { fpEnd: 1751241600, period: 'Q2 2025', year: 2025, value: 120, ...(yoy !== undefined ? { yoy } : {}) },
        { fpEnd: 1743379200, period: 'Q1 2025', year: 2025, value: 100, yoy: '99' },
        { fpEnd: 1719705600, period: 'Q2 2024', year: 2024, value: 150, yoy: '99' },
      ],
    }] }] } },
  };
}

function context(financials: FinancialReport): StrategyContext {
  return {
    symbol: financials.symbol,
    data: { symbol: financials.symbol, financials, evidence: [] },
    market: 'US', nowSeconds: 1751328000,
  };
}

describe('screening revenue growth requires reported YoY', () => {
  for (const yoy of [undefined, '', 'not-a-number', 'Infinity']) {
    it('does not label adjacent-quarter growth as YoY when the latest YoY is ' + String(yoy), () => {
      const ctx = context(report(yoy));
      // Q2 is up 20% from Q1, but down 20% from last year's Q2. Neither
      // adjacent values nor an older period's explicit YoY describes this YoY.
      expect(extractFinancialMetrics(ctx.data).revenueGrowth).toBeUndefined();
      expect(getScreeningStrategy('revenue-growth')!.compute(ctx)).toBeNull();
    });
  }

  it('preserves a latest explicitly reported zero without taking an older YoY', () => {
    const ctx = context(report('0'));
    expect(extractFinancialMetrics(ctx.data).revenueGrowth).toBe(0);
    expect(getScreeningStrategy('revenue-growth')!.compute(ctx)).toBeNull();
  });

  it('preserves the percent unit of a latest explicitly reported YoY', () => {
    const ctx = context(report('12.5'));
    const candidate = getScreeningStrategy('revenue-growth')!.compute(ctx);
    expect(extractFinancialMetrics(ctx.data).revenueGrowth).toBe(12.5);
    expect(candidate?.metrics.revenueGrowth).toBe(12.5);
    expect(candidate?.reasons).toEqual(['Revenue growth +12.5% YoY']);
  });

  it('keeps quality-growth missing when only quarterly revenue changes are known', () => {
    const financials = report();
    financials.statements.IS!.indicators[0].accounts.push(
      { field: 'ROE', name: 'ROE', values: [{ fpEnd: 1751241600, period: 'Q2 2025', year: 2025, value: 30 }] },
      { field: 'NetProfitMargin', name: 'Margin', values: [{ fpEnd: 1751241600, period: 'Q2 2025', year: 2025, value: 20 }] },
    );
    expect(getScreeningStrategy('quality-growth')!.compute(context(financials))).toBeNull();
  });

  it('does not persist a false YoY candidate through the actual Massive mapper and capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folio-screening-yoy-'));
    const calls: string[] = [];
    // Real Massive quarterly response shape; HTTP alone is replaced. The
    // production mapper, financials capability, executor and repository run.
    const originalFetch = globalThis.fetch;
    const fakeFetch = Object.assign(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      calls.push(String(input));
      return Response.json({ status: 'OK', results: [
        { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 2, period_end: '2025-06-30', revenue: 120 },
        { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 1, period_end: '2025-03-31', revenue: 100 },
        { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2024, fiscal_quarter: 2, period_end: '2024-06-30', revenue: 150 },
      ] });
    }, { preconnect: originalFetch.preconnect });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(fakeFetch);
    try {
      const provider = new MassiveFinancialDataProvider({ getApiKey: async () => 'fake-audit-key' });
      let mapped: FinancialReport | undefined;
      const registry = createCapabilityRegistry([createCompanyFinancialsCapability({
        ...defaultCapabilityFetchers,
        async getFinancialReport(symbol, kind, period) {
          const result = await provider.execute<FinancialReport>('company.financials', { symbol, kind, report: period });
          if (!result.ok) throw new Error(result.error.message);
          mapped = result.data;
          return result.data;
        },
      })]);
      const repository = new ScreeningRunRepository(new JsonFileStore(root));
      const service = new ScreeningService({ registry, repository, now: () => 1751328000000 });
      const run = await service.runScreening({ strategy: 'revenue-growth', universe: ['AAPL.US'], limit: 20 });

      expect(calls).toHaveLength(3);
      expect(calls.every((url) => new URL(url).searchParams.get('timeframe') === 'quarterly')).toBe(true);
      expect(mapped?.report).toBe('qf');
      expect(mapped?.statements.IS?.indicators[0].accounts[0].values.map((value) => value.value)).toEqual([120, 100, 150]);
      expect(run.failures).toEqual({});
      expect(run.candidates).toEqual([]);
      const reloaded = await new ScreeningRunRepository(new JsonFileStore(root)).getRun(run.id);
      expect(reloaded?.candidates).toEqual([]);
    } finally {
      fetch.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});

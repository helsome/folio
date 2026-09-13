import { describe, expect, it } from 'bun:test';
import { createMarketQuoteCapability } from './manifests/market-quote.ts';
import { createMarketKlineCapability } from './manifests/market-kline.ts';
import { createCompanyProfileCapability } from './manifests/company-profile.ts';
import { createCompanyFinancialsCapability } from './manifests/phase-two.ts';
import type { CapabilityFetchers } from './fetchers.ts';

const quote = {
  symbol: 'AAPL.US',
  instrumentId: 'XNAS:AAPL',
  lastPrice: 200,
  change: 3,
  changePercent: 1.5,
  volume: 1234,
  timestamp: 1710000000,
  high: 203,
  low: 198,
  open: 199,
  prevClose: 197,
};

function fetchers(overrides: Partial<CapabilityFetchers> = {}): CapabilityFetchers {
  return {
    getQuote: async () => quote,
    getKline: async () => [],
    getIntraday: async () => [],
    getMarketStatus: async () => [],
    getStaticInfo: async () => ({ symbol: 'AAPL.US', name: 'Apple' }),
    getCalcIndex: async () => ({ symbol: 'AAPL.US' }),
    getNews: async () => [],
    getPortfolio: async () => ({ baseCurrency: 'USD', accounts: [], holdings: [], fetchedAt: 0 }),
    getDepth: async () => ({ symbol: 'AAPL.US', bids: [], asks: [] }),
    getTrades: async () => [],
    getCapitalFlow: async () => ({
      symbol: 'AAPL.US',
      timestamp: 0,
      capitalIn: { large: 0, medium: 0, small: 0 },
      capitalOut: { large: 0, medium: 0, small: 0 },
    }),
    getMarketTemperature: async () => ({
      market: 'US',
      temperature: 50,
      description: '',
      valuation: 50,
      sentiment: 50,
    }),
    getFinancialReport: async () => ({ symbol: 'AAPL.US', report: 'qf', statements: {} }),
    getInstitutionRating: async () => ({ symbol: 'AAPL.US', recommend: 'buy' }),
    getDividends: async () => [],
    getEpsForecasts: async () => [],
    getCalendarEvents: async () => [],
    getAccountPositions: async () => [],
    getAssets: async () => [],
    getCashFlow: async () => [],
    ...overrides,
  };
}

describe('market.quote manifest', () => {
  it('validates input via TypeBox and returns provenance + summary', async () => {
    const cap = createMarketQuoteCapability(fetchers());

    await expect(
      cap.execute({ symbol: 123 } as unknown as { symbol: string }, {})
    ).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_INVALID' });

    const result = await cap.execute({ symbol: 'aapl.us' }, { now: () => 12345 });
    expect(result.provenance).toMatchObject({
      provider: 'longbridge',
      fetchedAt: 12345,
      stale: false,
      instrumentId: 'XNAS:AAPL',
    });
    expect(result.data.symbol).toBe('AAPL.US');
    expect(result.summary).toContain('AAPL.US');
  });

  it('registers under the expected id, tool name, auth, and category', () => {
    const cap = createMarketQuoteCapability(fetchers());
    expect(cap.id).toBe('market.quote');
    expect(cap.toolName).toBe('get_quote');
    expect(cap.auth).toBe('public');
    expect(cap.category).toBe('market');
    expect(cap.riskLevel).toBe('read');
  });

  it('preserves the answering provider provenance from the gateway', async () => {
    const routed = fetchers({
      getQuote: async () => {
        throw new Error('legacy fetcher should not be called');
      },
      execute: async <T>() => ({
        ok: true as const,
        data: quote as T,
        provenance: {
          providerId: 'massive',
          providerName: 'Massive',
          fetchedAt: 20000,
          marketTime: 19000,
          delayed: true,
          stale: false,
        },
      }),
    });

    const result = await createMarketQuoteCapability(routed).execute(
      { symbol: 'AAPL.US' },
      { now: () => 99999 }
    );
    expect(result.provenance).toEqual({
      provider: 'massive',
      providerId: 'massive',
      fetchedAt: 20000,
      marketTime: 19000,
      delayed: true,
      stale: false,
    });
  });
});

describe('provider-routed history and fundamentals manifests', () => {
  it('uses gateway provenance for K-line history and company profile', async () => {
    const klines = [{ symbol: 'AAPL.US', timestamp: 18000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
    const info = { symbol: 'AAPL.US', name: 'Apple' };
    const financials = { symbol: 'AAPL.US', report: 'qf', statements: {} };
    const routed = fetchers({
      execute: async <T>(capabilityId: string) => ({
        ok: true as const,
        data: (capabilityId === 'market.kline' ? klines : capabilityId === 'company.financials' ? financials : info) as T,
        provenance: {
          providerId: 'massive',
          providerName: 'Massive',
          fetchedAt: 22000,
          stale: false,
        },
      }),
    });

    const history = await createMarketKlineCapability(routed).execute({ symbol: 'AAPL.US', limit: 1 });
    const profile = await createCompanyProfileCapability(routed).execute({ symbol: 'AAPL.US' });
    const fundamentals = await createCompanyFinancialsCapability(routed).execute({ symbol: 'AAPL.US' });
    expect(history.provenance.provider).toBe('massive');
    expect(history.provenance.marketTime).toBe(18000);
    expect(profile.provenance.provider).toBe('massive');
    expect(fundamentals.provenance.provider).toBe('massive');
  });
});

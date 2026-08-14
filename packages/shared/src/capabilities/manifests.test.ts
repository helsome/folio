import { describe, expect, it } from 'bun:test';
import { createMarketQuoteCapability } from './manifests/market-quote.ts';
import type { CapabilityFetchers } from './fetchers.ts';

const quote = {
  symbol: 'AAPL.US',
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
});

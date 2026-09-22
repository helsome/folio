import { describe, expect, it } from 'bun:test';
import { createMarketQuoteCapability } from './manifests/market-quote.ts';
import { createMarketKlineCapability } from './manifests/market-kline.ts';
import { createMarketIntradayCapability } from './manifests/market-intraday.ts';
import { createResearchNewsCapability } from './manifests/research-news.ts';
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
});

// Kline / intraday / news timestamps are epoch SECONDS (each manifest's own
// formatter does `timestamp * 1000`), but `provenance.marketTime` is epoch MS
// everywhere else — `market.quote` writes `quote.timestamp * 1000` and the
// longbridge adapter's `marketTimeMsFrom()` multiplies by 1000.
const SECOND_TS = 1710000000;

describe('provenance.marketTime is epoch milliseconds', () => {
  it('market.kline converts the last bar timestamp from seconds', async () => {
    const cap = createMarketKlineCapability(
      fetchers({
        getKline: async () => [
          { symbol: 'AAPL.US', timestamp: SECOND_TS - 86400, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          { symbol: 'AAPL.US', timestamp: SECOND_TS, open: 2, high: 2, low: 2, close: 2, volume: 2 },
        ],
      })
    );
    const result = await cap.execute({ symbol: 'AAPL.US' }, { now: () => 12345 });
    expect(result.provenance.marketTime).toBe(SECOND_TS * 1000);
  });

  it('market.intraday converts the last tick timestamp from seconds', async () => {
    const cap = createMarketIntradayCapability(
      fetchers({
        getIntraday: async () => [
          { symbol: 'AAPL.US', timestamp: SECOND_TS - 60, price: 199, volume: 10 },
          { symbol: 'AAPL.US', timestamp: SECOND_TS, price: 200, volume: 20 },
        ],
      })
    );
    const result = await cap.execute({ symbol: 'AAPL.US' }, { now: () => 12345 });
    expect(result.provenance.marketTime).toBe(SECOND_TS * 1000);
  });

  it('research.news converts the latest item timestamp from seconds', async () => {
    const cap = createResearchNewsCapability(
      fetchers({
        getNews: async () => [
          {
            id: 'n-1',
            title: 'Apple ships',
            summary: 'A summary.',
            url: 'https://example.com/n1',
            timestamp: SECOND_TS,
            symbols: ['AAPL.US'],
          },
        ],
      })
    );
    const result = await cap.execute({ symbol: 'AAPL.US' }, { now: () => 12345 });
    expect(result.provenance.marketTime).toBe(SECOND_TS * 1000);
  });

  it('leaves marketTime undefined when the series is empty', async () => {
    const cap = createMarketKlineCapability(fetchers({ getKline: async () => [] }));
    const result = await cap.execute({ symbol: 'AAPL.US' }, { now: () => 12345 });
    expect(result.provenance.marketTime).toBeUndefined();
  });
});

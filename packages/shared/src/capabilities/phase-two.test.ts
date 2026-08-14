import { describe, expect, it } from 'bun:test';
import { createPhaseTwoCapabilities, createMarketDepthCapability, createResearchEventsCapability, createPortfolioPositionsCapability } from './manifests/phase-two.ts';
import type { CapabilityFetchers } from './fetchers.ts';

function fetchers(overrides: Partial<CapabilityFetchers> = {}): CapabilityFetchers {
  return {
    getQuote: async () => ({} as never),
    getKline: async () => [],
    getIntraday: async () => [],
    getMarketStatus: async () => [],
    getStaticInfo: async () => ({ symbol: 'NVDA.US', name: 'NVIDIA' }),
    getCalcIndex: async () => ({ symbol: 'NVDA.US' }),
    getNews: async () => [],
    getPortfolio: async () => ({ totalValue: 0, cash: 0, positions: [] }),
    getDepth: async () => ({ symbol: 'NVDA.US', bids: [], asks: [] }),
    getTrades: async () => [],
    getCapitalFlow: async () => ({
      symbol: 'NVDA.US',
      timestamp: 1710000000,
      capitalIn: { large: 0, medium: 0, small: 0 },
      capitalOut: { large: 0, medium: 0, small: 0 },
    }),
    getMarketTemperature: async () => ({
      market: 'US',
      temperature: 62,
      description: '',
      valuation: 78,
      sentiment: 46,
    }),
    getFinancialReport: async () => ({ symbol: 'NVDA.US', report: 'qf', statements: {} }),
    getInstitutionRating: async () => ({ symbol: 'NVDA.US', recommend: 'strong_buy' }),
    getDividends: async () => [],
    getEpsForecasts: async () => [],
    getCalendarEvents: async () => [],
    getAccountPositions: async () => [],
    getAssets: async () => [],
    getCashFlow: async () => [],
    ...overrides,
  };
}

const ID_TO_TOOL: Record<string, string> = {
  'market.depth': 'get_market_depth',
  'market.trades': 'get_trades',
  'market.capitalFlow': 'get_capital_flow',
  'market.sentiment': 'get_market_sentiment',
  'company.financials': 'get_financials',
  'company.ratings': 'get_ratings',
  'company.dividends': 'get_dividends',
  'company.earnings': 'get_earnings',
  'research.events': 'get_calendar_events',
  'portfolio.positions': 'get_positions',
  'portfolio.assets': 'get_assets',
  'portfolio.cashFlow': 'get_cash_flow',
};

const ACCOUNT_IDS = new Set(['portfolio.positions', 'portfolio.assets', 'portfolio.cashFlow']);

describe('phase-2 capability aggregation', () => {
  it('exports all twelve capabilities with unique ids and tool names', () => {
    const caps = createPhaseTwoCapabilities(fetchers());
    expect(caps).toHaveLength(12);
    expect(new Set(caps.map((c) => c.id)).size).toBe(12);
    expect(new Set(caps.map((c) => c.toolName)).size).toBe(12);
  });

  it('registers every id under its target tool name, auth, and category', () => {
    for (const cap of createPhaseTwoCapabilities(fetchers())) {
      expect(cap.toolName).toBe(ID_TO_TOOL[cap.id]);
      expect(cap.riskLevel).toBe('read');
      expect(cap.auth).toBe(ACCOUNT_IDS.has(cap.id) ? 'account' : 'public');
      expect(cap.id).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(cap.description.length).toBeGreaterThan(20);
    }
  });

  it('keeps phase-2 ids disjoint from phase-1 ids', () => {
    const phaseOne = new Set([
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.status',
      'company.profile',
      'company.valuation',
      'research.news',
      'portfolio.summary',
    ]);
    for (const cap of createPhaseTwoCapabilities(fetchers())) {
      expect(phaseOne.has(cap.id)).toBe(false);
    }
  });
});

describe('phase-2 manifest input validation', () => {
  it('rejects a non-string symbol with CAPABILITY_INPUT_INVALID', async () => {
    const depth = createMarketDepthCapability(fetchers());
    await expect(
      depth.execute({ symbol: 123 } as never, {})
    ).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_INVALID' });
  });

  it('normalizes symbols and returns provenance + summary', async () => {
    const depth = createMarketDepthCapability(fetchers());
    const result = await depth.execute({ symbol: ' nvda.us ' }, { now: () => 12345 });
    expect(result.provenance).toMatchObject({
      provider: 'longbridge',
      fetchedAt: 12345,
      stale: false,
    });
    expect(result.data.symbol).toBe('NVDA.US');
    expect(result.summary).toContain('NVDA.US');
  });

  it('validates research.events requires a known eventType', async () => {
    const events = createResearchEventsCapability(fetchers());
    await expect(
      events.execute({ eventType: 'bogus' } as never, {})
    ).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_INVALID' });
  });

  it('runs portfolio account capabilities without an input', async () => {
    const positions = createPortfolioPositionsCapability(fetchers());
    const result = await positions.execute({}, { now: () => 12345 });
    expect(result.data).toEqual([]);
    expect(result.summary).toContain('0 positions');
  });
});

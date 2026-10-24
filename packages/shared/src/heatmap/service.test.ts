import { describe, expect, it } from 'bun:test';
import { DEFAULT_INSTRUMENT_CATALOG, type CanonicalInstrument, type InstrumentResolution, type ProviderProvenance, type Quote, type StaticInfo } from '@finagent/core';
import { MarketDataService, type MarketDataFetchers } from '../agent/market-data-service.ts';
import { HeatmapService, parseHeatmapSource } from './service.ts';

const NOW = 1_800_000_000_000;
const instruments = new Map(DEFAULT_INSTRUMENT_CATALOG.map((instrument) => [instrument.instrumentId, instrument]));
const bySymbol = new Map([...instruments.values()].map((instrument) => [
  instrument.providerAliases.find((alias) => alias.providerId === 'longbridge')?.symbol ?? instrument.instrumentId,
  instrument,
]));

function quote(symbol: string): Quote {
  return { symbol, lastPrice: 101, change: 1, changePercent: 1, volume: 1, timestamp: NOW / 1000, high: 101, low: 100, open: 100, prevClose: 100 };
}

function provenance(instrumentId: string, override: Partial<ProviderProvenance> = {}): ProviderProvenance {
  return { providerId: 'fixture-provider', providerName: 'Fixture', instrumentId, fetchedAt: NOW, marketTime: NOW, stale: false, ...override };
}

function marketData(overrides: {
  getQuoteResult?: (symbol: string, signal?: AbortSignal) => Promise<{ data: Quote; provenance: ProviderProvenance }>;
  getStaticInfo?: (symbol: string, signal?: AbortSignal) => Promise<StaticInfo>;
  getMarketStatus?: () => Promise<Array<{ market: string; status: string }>>;
} = {}) {
  const fetchers: Partial<MarketDataFetchers> = {
    getQuote: async (symbol) => quote(symbol),
    getQuoteResult: async (symbol) => {
      const instrument = bySymbol.get(symbol)!;
      return { data: quote(symbol), provenance: provenance(instrument.instrumentId) };
    },
    getStaticInfo: async (symbol) => ({ symbol, name: symbol, industry: { name: 'Technology', classification: 'SIC', code: '3571' } }),
    getMarketStatus: async () => [{ market: 'US', status: 'Open' }],
    ...overrides,
  };
  return new MarketDataService({ now: () => NOW, fetchers });
}

function source(entries: Array<{ symbol: string; holding?: Record<string, unknown> }>, kind: 'watchlist' | 'portfolio' = 'watchlist') {
  return parseHeatmapSource({ schemaVersion: 1, kind, id: 'watch', revision: 'rev-1', capturedAt: NOW, baseCurrency: 'USD', valuationCurrency: 'USD', entries });
}

function resolver(query: string): InstrumentResolution {
  const instrument = bySymbol.get(query) ?? instruments.get(query);
  return instrument
    ? { status: 'resolved', query, matchedBy: 'provider_alias', instrument }
    : { status: 'not_found', query };
}

describe('heatmap source and aggregation', () => {
  it('validates versioned local snapshots and canonicalizes/deduplicates aliases', async () => {
    expect(() => parseHeatmapSource({ kind: 'portfolio', entries: new Array(1001).fill({ symbol: 'AAPL.US', holding: {} }) })).toThrow();
    const result = await new HeatmapService({ marketData: marketData(), resolve: resolver, now: () => NOW })
      .load(source([{ symbol: 'AAPL.US' }, { symbol: 'XNAS:AAPL' } as { symbol: string } ]));
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]?.instrument.instrumentId).toBe('XNAS:AAPL');
    expect(result.tiles[0]?.state).toBe('current');
    expect(result.tiles[0]?.industry?.code).toBe('3571');
    expect('entries' in result.source).toBe(false);
  });

  it('does not call market providers for an empty snapshot', async () => {
    let requests = 0;
    const market = marketData({ getMarketStatus: async () => { requests += 1; return []; } });
    const result = await new HeatmapService({ marketData: market, resolve: resolver, now: () => NOW })
      .load(source([]));
    expect(result.tiles).toEqual([]);
    expect(requests).toBe(0);
  });

  it('keeps provider failures, stale quotes, and sample data out of current returns', async () => {
    const service = new HeatmapService({
      marketData: marketData({ getQuoteResult: async (symbol) => {
        const instrument = bySymbol.get(symbol)!;
        if (symbol === 'AAPL.US') throw new Error('offline');
        return { data: quote(symbol), provenance: provenance(instrument.instrumentId, { stale: true, delayed: true }) };
      } }),
      resolve: resolver, now: () => NOW,
    });
    const result = await service.load(source([{ symbol: 'AAPL.US' }, { symbol: 'NVDA.US' }]));
    expect(result.tiles[0]?.changePercent).toBeNull();
    expect(result.tiles[0]?.state).toBe('unknown');
    expect(result.tiles[1]?.state).toBe('stale');
    expect(result.tiles[1]?.changePercent).toBe(1);
  });

  it('marks market-closed quotes stale while retaining their provider provenance', async () => {
    const service = new HeatmapService({
      marketData: marketData({
        getMarketStatus: async () => [{ market: 'US', status: 'Closed' }],
      }),
      resolve: resolver, now: () => NOW,
    });
    const result = await service.load(source([{ symbol: 'AAPL.US' }]));
    expect(result.tiles[0]?.state).toBe('stale');
    expect(result.tiles[0]?.provenance?.providerName).toBe('Fixture');
    expect(result.tiles[0]?.session).toBe('Closed');
  });

  it.each([
    ['delayed', { delayed: true }, 'stale'],
    ['old timestamp', { marketTime: NOW - 16 * 60_000 }, 'stale'],
    ['demo provider', { providerId: 'demo' }, 'unknown'],
    ['mismatched identity', { instrumentId: 'XNAS:NVDA' }, 'unknown'],
    ['missing timestamp', { marketTime: undefined }, 'unknown'],
  ] as const)('keeps %s data explicitly labeled', async (_label, override, state) => {
    const service = new HeatmapService({ marketData: marketData({
      getQuoteResult: async (symbol) => ({ data: quote(symbol), provenance: provenance('XNAS:AAPL', override) }),
      getStaticInfo: async (symbol) => ({ symbol, name: symbol }),
    }), resolve: resolver, now: () => NOW });
    const result = await service.load(source([{ symbol: 'AAPL.US' }]));
    expect(result.tiles[0]?.state).toBe(state);
    expect(result.tiles[0]?.industry).toBeUndefined();
    if (state === 'unknown') expect(result.tiles[0]?.changePercent).toBeNull();
  });

  it('keeps mixed currencies and short positions outside the weight denominator', async () => {
    const portfolio = { ...source([
      { symbol: 'AAPL.US', holding: { currency: 'USD', quantity: 2, marketValue: 200, marketValueBase: 200 } },
      { symbol: 'NVDA.US', holding: { currency: 'USD', quantity: 1, marketValue: 100, marketValueBase: 100 } },
      { symbol: 'TSLA.US', holding: { currency: 'HKD', quantity: 1, marketValue: 80, marketValueBase: 80 } },
      { symbol: 'BABA.US', holding: { currency: 'USD', quantity: -1, marketValue: -40, marketValueBase: -40 } },
    ], 'portfolio'), baseCurrency: 'HKD' };
    const result = await new HeatmapService({ marketData: marketData(), resolve: resolver, now: () => NOW }).load(portfolio);
    expect(result.weightedAvailable).toBe(false);
    expect(result.tiles.find((tile) => tile.workspaceSymbol === 'AAPL.US')?.weight).toBeNull();
    expect(result.tiles.find((tile) => tile.workspaceSymbol === 'AAPL.US')?.exclusion).toBe('currency');
    expect(result.tiles.find((tile) => tile.workspaceSymbol === 'TSLA.US')?.valueBase).toBe(80);
    expect(result.tiles.find((tile) => tile.workspaceSymbol === 'BABA.US')?.exclusion).toBe('short');
  });

  it('weights USD and HKD holdings using the snapshot conversion and excludes short/zero exposure', async () => {
    const portfolio = source([
      { symbol: 'AAPL.US', holding: { currency: 'USD', quantity: 2, marketValue: 200, marketValueBase: 200 } },
      { symbol: '0700.HK', holding: { currency: 'HKD', quantity: 1, marketValue: 780, marketValueBase: 100 } },
      { symbol: 'BABA.US', holding: { currency: 'USD', quantity: -1, marketValue: -40, marketValueBase: -40 } },
      { symbol: 'NVDA.US', holding: { currency: 'USD', quantity: 0, marketValue: 0, marketValueBase: 0 } },
    ], 'portfolio');
    const result = await new HeatmapService({ marketData: marketData(), resolve: resolver, now: () => NOW }).load(portfolio);
    expect(result.weightedAvailable).toBe(true);
    expect(result.tiles.filter((tile) => !tile.exclusion).map((tile) => tile.weight).sort()).toEqual([1 / 3, 2 / 3]);
    expect(result.tiles.filter((tile) => tile.exclusion).every((tile) => tile.weight === null)).toBe(true);
  });

  it('propagates cancellation and only keeps canonical matching provider data', async () => {
    const controller = new AbortController();
    const service = new HeatmapService({ marketData: marketData({ getQuoteResult: async (_symbol, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))) }), resolve: resolver, now: () => NOW });
    const pending = service.load(source([{ symbol: 'AAPL.US' }]), controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('limits a 100-instrument load to four concurrent gateway operations', async () => {
    let active = 0;
    let maximum = 0;
    const calls = { quote: 0, profile: 0, status: 0 };
    const generated = Array.from({ length: 100 }, (_, index): CanonicalInstrument => ({
      instrumentId: `XNAS:T${index}`, symbol: `T${index}`, name: `Fixture ${index}`, market: 'US', country: 'US', assetType: 'equity', currency: 'USD',
      providerAliases: [{ providerId: 'longbridge', symbol: `T${index}.US` }],
    }));
    const source100 = source(generated.map((item) => ({ symbol: item.providerAliases[0]!.symbol })));
    const measure = (query: string): InstrumentResolution => ({ status: 'resolved', query, matchedBy: 'provider_alias', instrument: generated[Number(query.match(/\d+/)?.[0])]! });
    const slowMarket = marketData({
      getQuoteResult: async (symbol, signal) => {
        calls.quote += 1;
        active += 1; maximum = Math.max(maximum, active);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1);
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
        });
        active -= 1;
        const instrument = generated[Number(symbol.match(/\d+/)?.[0])]!;
        return { data: quote(symbol), provenance: provenance(instrument.instrumentId) };
      },
      getStaticInfo: async (symbol) => { calls.profile += 1; return { symbol, name: symbol }; },
      getMarketStatus: async () => { calls.status += 1; return [{ market: 'US', status: 'Open' }]; },
    });
    const started = performance.now();
    const service = new HeatmapService({ marketData: slowMarket, resolve: measure, now: () => NOW });
    const result = await service.load(source100);
    const coldMs = performance.now() - started;
    const warmStarted = performance.now();
    const warm = await service.load(source100);
    console.info(`heatmap fixture benchmark: 100 instruments, cold ${coldMs.toFixed(1)}ms, warm ${(performance.now() - warmStarted).toFixed(1)}ms, calls ${JSON.stringify(calls)}, max quote concurrency ${maximum}`);
    expect(result.tiles).toHaveLength(100);
    expect(warm.tiles).toEqual(result.tiles);
    expect(calls).toEqual({ quote: 100, profile: 100, status: 1 });
    expect(maximum).toBeLessThanOrEqual(4);
  });
});

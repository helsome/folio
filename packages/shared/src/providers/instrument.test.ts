import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  DEFAULT_INSTRUMENT_CATALOG,
  InstrumentResolver,
  type CanonicalInstrument,
  type NewsItem,
  type Quote,
  type StaticInfo,
} from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import {
  InstrumentCatalogStore,
  bindProviderInput,
  stampInstrumentId,
} from './instrument.ts';
import { ProviderFetchError, createRouterFetchers } from './router-fetchers.ts';
import { ProviderRouter } from './router.ts';
import type { CapabilityId, FinancialDataProvider, ProviderHealth, ProviderResult } from '@finagent/core';

const APPLE = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!;

describe('bindProviderInput', () => {
  it('converts a canonical instrument into each provider symbol', () => {
    const longbridge = bindProviderInput({ instrument: APPLE }, 'longbridge');
    const massive = bindProviderInput({ instrument: APPLE }, 'massive');
    expect(longbridge).toMatchObject({ ok: true, symbol: 'AAPL.US', instrumentId: 'XNAS:AAPL' });
    expect(massive).toMatchObject({ ok: true, symbol: 'AAPL', instrumentId: 'XNAS:AAPL' });
  });

  it('rejects a listing the provider cannot serve', () => {
    const tencent = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XHKG:0700')!;
    const bound = bindProviderInput({ instrument: tencent }, 'massive');
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.error.code).toBe('UNSUPPORTED_CAPABILITY');
  });
});

describe('InstrumentCatalogStore', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('seeds, persists, and reloads the provider alias catalog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'folio-instruments-'));
    dirs.push(dir);
    const store = new InstrumentCatalogStore(new JsonFileStore(dir), () => 1_700_000_000_000);
    const first = await store.load();
    expect(first.resolve('AAPL.US')).toMatchObject({
      status: 'resolved',
      instrument: { instrumentId: 'XNAS:AAPL' },
    });

    const restored = await new InstrumentCatalogStore(new JsonFileStore(dir)).load();
    expect(restored.resolve('0700.HK')).toMatchObject({
      status: 'resolved',
      instrument: { instrumentId: 'XHKG:0700' },
    });
    expect(restored.snapshot(1).schemaVersion).toBe(1);
  });
});

describe('createRouterFetchers instrument binding', () => {
  it('passes one canonical instrument to adapters and stamps quote/profile/news', async () => {
    const seen: Array<{ id: string; capabilityId: string; input: unknown }> = [];
    const router = new ProviderRouter();
    router.register(fakeProvider('longbridge', 'Longbridge', async (capabilityId, input) => {
      seen.push({ id: 'longbridge', capabilityId, input });
      return success('longbridge', 'Longbridge', payload(capabilityId, 'AAPL.US'));
    }));
    router.register(fakeProvider('massive', 'Massive', async (capabilityId, input) => {
      seen.push({ id: 'massive', capabilityId, input });
      return success('massive', 'Massive', payload(capabilityId, 'AAPL'));
    }));
    router.setRouting({ primary: 'longbridge', fallback: 'massive' });

    const fetchers = createRouterFetchers(router, {
      resolve: (query) => new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG).resolve(query),
    });

    const quote = await fetchers.getQuote('AAPL.US');
    const profile = await fetchers.getStaticInfo('Apple');
    const news = await fetchers.getNews('XNAS:AAPL');

    expect(quote.instrumentId).toBe('XNAS:AAPL');
    expect(profile.instrumentId).toBe('XNAS:AAPL');
    expect(news[0]?.instrumentId).toBe('XNAS:AAPL');
    expect(
      seen.map((call) => (call.input as { instrument: CanonicalInstrument }).instrument.instrumentId)
    ).toEqual(['XNAS:AAPL', 'XNAS:AAPL', 'XNAS:AAPL']);
  });

  it('does not silently pick a dual-listed name', async () => {
    const router = new ProviderRouter();
    router.register(
      fakeProvider('longbridge', 'Longbridge', async () =>
        success('longbridge', 'Longbridge', { symbol: 'BABA.US' })
      )
    );
    router.setRouting({ primary: 'longbridge' });
    const fetchers = createRouterFetchers(router, {
      resolve: (query) => new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG).resolve(query),
    });

    let caught: unknown;
    try {
      await fetchers.getQuote('Alibaba');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderFetchError);
    if (caught instanceof ProviderFetchError) {
      expect(caught.code).toBe('AMBIGUOUS_INSTRUMENT');
      expect(caught.candidates?.map((candidate) => candidate.instrumentId)).toEqual([
        'XNYS:BABA',
        'XHKG:9988',
      ]);
      expect(caught.message).toContain('XNYS:BABA');
      expect(caught.message).toContain('XHKG:9988');
    }
  });
});

describe('stampInstrumentId', () => {
  it('stamps nested quote and news payloads without dropping fields', () => {
    const quote = stampInstrumentId({ symbol: 'AAPL.US', lastPrice: 1 } as Quote, 'XNAS:AAPL');
    expect(quote).toEqual({ symbol: 'AAPL.US', lastPrice: 1, instrumentId: 'XNAS:AAPL' } as Quote);
    const news = stampInstrumentId(
      [{ id: '1', title: 't', summary: '', url: '', timestamp: 0, symbols: ['AAPL.US'] }] as NewsItem[],
      'XNAS:AAPL'
    );
    expect(news[0]?.instrumentId).toBe('XNAS:AAPL');
  });
});

function success<T>(providerId: string, providerName: string, data: T): ProviderResult<T> {
  return {
    ok: true,
    data,
    provenance: { providerId, providerName, fetchedAt: 1, stale: false },
  };
}

function payload(capabilityId: string, symbol: string): Quote | StaticInfo | NewsItem[] {
  if (capabilityId === 'company.profile') {
    return { symbol, name: 'Apple Inc.' };
  }
  if (capabilityId === 'research.news') {
    return [{ id: 'n1', title: 'News', summary: '', url: 'https://example.com', timestamp: 1, symbols: [symbol] }];
  }
  return {
    symbol,
    lastPrice: 1,
    change: 0,
    changePercent: 0,
    volume: 0,
    timestamp: 1,
    high: 0,
    low: 0,
    open: 0,
    prevClose: 0,
  };
}

function fakeProvider(
  id: string,
  name: string,
  handler: (
    capabilityId: CapabilityId,
    input: unknown
  ) => Promise<ProviderResult<unknown>>
): FinancialDataProvider {
  return {
    kind: 'financial-data',
    id,
    name,
    status: async (): Promise<ProviderHealth> => ({ status: 'connected', lastCheck: 1 }),
    capabilities: () => ['market.quote', 'company.profile', 'research.news'],
    markets: () => [{ id: 'US', name: 'United States' }],
    execute: async <T>(capabilityId: CapabilityId, input: unknown): Promise<ProviderResult<T>> => {
      const bound = bindProviderInput(input, id);
      if (!bound.ok) return { ok: false, error: bound.error };
      const result = await handler(capabilityId, bound.input);
      if (!result.ok || !bound.instrumentId) return result as ProviderResult<T>;
      return {
        ok: true,
        data: stampInstrumentId(result.data, bound.instrumentId) as T,
        provenance: { ...result.provenance, instrumentId: bound.instrumentId },
      };
    },
  };
}

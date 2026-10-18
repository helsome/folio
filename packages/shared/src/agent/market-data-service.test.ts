import { describe, expect, it } from 'bun:test';
import type { ProviderProvenance, Quote } from '@finagent/core';
import { MarketDataService } from './market-data-service.ts';

const BASE_QUOTE: Quote = {
  symbol: 'AAPL.US',
  lastPrice: 200,
  change: 3,
  changePercent: 1.5,
  volume: 1234,
  timestamp: 1_710_000_000,
  high: 203,
  low: 198,
  open: 199,
  prevClose: 197,
};

const ROUTER_PROVENANCE: ProviderProvenance = {
  providerId: 'massive',
  providerName: 'Massive',
  fetchedAt: 1_710_000_000_123,
  marketTime: 1_710_000_000_000,
  delayed: true,
  stale: false,
  failoverTrail: [
    { providerId: 'longbridge', code: 'TIMEOUT', kind: 'timeout', attempts: 1, at: 1_710_000_000_100 },
  ],
};

describe('MarketDataService.getQuote provenance (#332)', () => {
  it('prefers the provenance-aware fetcher and stamps the actual source on the quote', async () => {
    const service = new MarketDataService({
      fetchers: {
        getQuote: async () => {
          throw new Error('raw fetcher must not be used when getQuoteResult exists');
        },
        getQuoteResult: async () => ({ data: BASE_QUOTE, provenance: ROUTER_PROVENANCE }),
      },
    });

    const quote = await service.getQuote('AAPL.US');

    expect(quote.lastPrice).toBe(200);
    expect(quote.provenance).toMatchObject({
      providerId: 'massive',
      providerName: 'Massive',
      fetchedAt: 1_710_000_000_123,
      delayed: true,
    });
    expect(quote.provenance?.failoverTrail?.[0]).toMatchObject({ providerId: 'longbridge' });
  });

  it('serves the raw quote unprovenanced when only the raw fetcher exists', async () => {
    const service = new MarketDataService({
      fetchers: { getQuote: async () => BASE_QUOTE },
    });

    const quote = await service.getQuote('AAPL.US');

    expect(quote.lastPrice).toBe(200);
    expect(quote.provenance).toBeUndefined();
  });

  it('caches one quote per symbol regardless of the fetcher used', async () => {
    let calls = 0;
    const service = new MarketDataService({
      fetchers: {
        getQuote: async () => {
          calls += 1;
          return BASE_QUOTE;
        },
      },
    });

    await service.getQuote('AAPL.US');
    await service.getQuote('AAPL.US');

    expect(calls).toBe(1);
  });
});

import { describe, expect, it } from 'bun:test';
import type { ProviderProvenance, Quote } from '@finagent/core';
import { MarketDataService } from './market-data-service.ts';

const quote: Quote = { symbol: 'AAPL.US', lastPrice: 100, change: 1, changePercent: 1, volume: 10, timestamp: 1_800_000_000, high: 101, low: 99, open: 99, prevClose: 99 };
const provenance: ProviderProvenance = { providerId: 'fixture', providerName: 'Fixture', instrumentId: 'XNAS:AAPL', fetchedAt: 1_800_000_000_000, stale: false };

describe('MarketDataService quote provenance cache', () => {
  it('shares enriched and ordinary quote reads through one cached request', async () => {
    let calls = 0;
    const market = new MarketDataService({ fetchers: {
      getQuote: async () => quote,
      getQuoteResult: async () => { calls += 1; return { data: quote, provenance }; },
    } });
    expect(await market.getQuote('AAPL.US')).toEqual(quote);
    expect(await market.getQuoteResult('AAPL.US')).toEqual({ data: quote, provenance });
    expect(calls).toBe(1);
  });

  it('cancels one subscriber without aborting a shared request still in use', async () => {
    let providerSignal: AbortSignal | undefined;
    let resolveRequest!: (value: { data: Quote; provenance: ProviderProvenance }) => void;
    const market = new MarketDataService({ fetchers: {
      getQuoteResult: (_symbol, signal) => {
        providerSignal = signal;
        return new Promise((resolve) => { resolveRequest = resolve; });
      },
    } });
    const first = new AbortController();
    const firstRead = market.getQuoteResult('AAPL.US', first.signal);
    const secondRead = market.getQuoteResult('AAPL.US');
    first.abort();
    await expect(firstRead).rejects.toThrow('aborted');
    expect(providerSignal?.aborted).toBe(false);
    resolveRequest({ data: quote, provenance });
    expect(await secondRead).toEqual({ data: quote, provenance });
  });

  it('aborts the provider when its last heatmap subscriber cancels', async () => {
    let providerSignal: AbortSignal | undefined;
    const market = new MarketDataService({ fetchers: {
      getQuoteResult: (_symbol, signal) => {
        providerSignal = signal;
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      },
    } });
    const controller = new AbortController();
    const read = market.getQuoteResult('AAPL.US', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(read).rejects.toThrow('aborted');
    expect(providerSignal?.aborted).toBe(true);
  });
});

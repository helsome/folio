import { describe, expect, it } from 'bun:test';
import { DEFAULT_INSTRUMENT_CATALOG, InstrumentResolver } from '@finagent/core';
import { validateSymbol } from '@finagent/longbridge-tools';
import { captureWatchlistContext } from './watchlist-context.ts';

const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG);

describe('captureWatchlistContext', () => {
  it('resolves five real listings with canonical identities and compatible provider symbols', () => {
    const snapshot = captureWatchlistContext(
      ['AAPL.US', 'TSLA.US', 'NVDA.US', 'BABA.US', '0700.HK'], resolver, 1700000000000
    );
    expect(snapshot).toMatchObject({ schemaVersion: 1, sourceId: 'default', capturedAt: 1700000000000 });
    expect(snapshot.instruments.map((instrument) => instrument.instrumentId)).toEqual([
      'XNAS:AAPL', 'XNAS:TSLA', 'XNAS:NVDA', 'XNYS:BABA', 'XHKG:0700',
    ]);
    expect(snapshot.instruments.map((instrument) =>
      instrument.providerAliases?.find((alias) => alias.providerId === 'longbridge')?.symbol
    )).toEqual(['AAPL.US', 'TSLA.US', 'NVDA.US', 'BABA.US', '0700.HK']);
    for (const instrument of snapshot.instruments) {
      const alias = instrument.providerAliases?.find((entry) => entry.providerId === 'longbridge');
      expect(alias).toBeDefined();
      expect(validateSymbol(alias!.symbol)).toBe(true);
      expect(validateSymbol(instrument.instrumentId)).toBe(false);
    }
    expect(Object.keys(snapshot.instruments[0]).sort()).toEqual(['instrumentId', 'providerAliases', 'symbol']);
  });

  it('copies provider aliases without retaining mutable catalog data', () => {
    const catalog = structuredClone(DEFAULT_INSTRUMENT_CATALOG);
    const snapshot = captureWatchlistContext(['AAPL.US'], new InstrumentResolver(catalog), 1);
    catalog[0]!.providerAliases[0]!.symbol = 'CHANGED.US';
    expect(snapshot.instruments[0]?.providerAliases?.[0]?.symbol).toBe('AAPL.US');
  });

  it('deduplicates aliases and versions membership independently of order or capture time', () => {
    const first = captureWatchlistContext(['aapl.us', 'AAPL', 'TSLA.US'], resolver, 1);
    const second = captureWatchlistContext(['TSLA', 'XNAS:AAPL'], resolver, 2);
    expect(first.instruments).toHaveLength(2);
    expect(first.version).toBe(second.version);
    expect(captureWatchlistContext(['AAPL.US'], resolver, 1).version).not.toBe(first.version);
  });

  it('rejects malformed, oversized and unresolved lists instead of silently dropping symbols', () => {
    for (const input of [null, {}, [], [''], [null], ['AAPL.US', 'UNKNOWN.US'], Array(101).fill('AAPL.US')]) {
      expect(() => captureWatchlistContext(input, resolver, 1)).toThrow();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import {
  createInstrumentId,
  getProviderSymbol,
  InstrumentResolver,
  type CanonicalInstrument,
} from './instrument.ts';

const APPLE: CanonicalInstrument = {
  instrumentId: 'XNAS:AAPL',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  nameAliases: ['Apple'],
  exchangeMic: 'XNAS',
  exchange: 'NASDAQ',
  market: 'US',
  country: 'US',
  assetType: 'equity',
  currency: 'USD',
  providerAliases: [
    { providerId: 'longbridge', symbol: 'AAPL.US' },
    { providerId: 'massive', symbol: 'AAPL' },
  ],
  externalIds: [{ type: 'isin', value: 'US0378331005' }],
};

const TENCENT: CanonicalInstrument = {
  instrumentId: 'XHKG:0700',
  symbol: '0700',
  name: 'Tencent Holdings Limited',
  nameAliases: ['Tencent', '腾讯控股'],
  exchangeMic: 'XHKG',
  exchange: 'HKEX',
  market: 'HK',
  country: 'HK',
  assetType: 'equity',
  currency: 'HKD',
  providerAliases: [{ providerId: 'longbridge', symbol: '0700.HK' }],
  externalIds: [{ type: 'isin', value: 'KYG875721634' }],
};

const ALIBABA_US: CanonicalInstrument = {
  instrumentId: 'XNYS:BABA',
  symbol: 'BABA',
  name: 'Alibaba Group Holding Limited',
  nameAliases: ['Alibaba'],
  exchangeMic: 'XNYS',
  exchange: 'NYSE',
  market: 'US',
  country: 'US',
  assetType: 'equity',
  currency: 'USD',
  providerAliases: [
    { providerId: 'longbridge', symbol: 'BABA.US' },
    { providerId: 'massive', symbol: 'BABA' },
  ],
};

const ALIBABA_HK: CanonicalInstrument = {
  instrumentId: 'XHKG:9988',
  symbol: '9988',
  name: 'Alibaba Group Holding Limited',
  nameAliases: ['Alibaba'],
  exchangeMic: 'XHKG',
  exchange: 'HKEX',
  market: 'HK',
  country: 'HK',
  assetType: 'equity',
  currency: 'HKD',
  providerAliases: [{ providerId: 'longbridge', symbol: '9988.HK' }],
};

const TESLA: CanonicalInstrument = {
  instrumentId: 'XNAS:TSLA',
  symbol: 'TSLA',
  name: 'Tesla, Inc.',
  nameAliases: ['Tesla'],
  exchangeMic: 'XNAS',
  exchange: 'NASDAQ',
  market: 'US',
  country: 'US',
  assetType: 'equity',
  currency: 'USD',
  providerAliases: [
    { providerId: 'longbridge', symbol: 'TSLA.US' },
    { providerId: 'massive', symbol: 'TSLA' },
  ],
  externalIds: [{ type: 'isin', value: 'US88160R1014' }],
};

const CATALOG = [APPLE, TENCENT, ALIBABA_US, ALIBABA_HK, TESLA];

describe('InstrumentResolver', () => {
  it('resolves canonical ids, canonical symbols, company names, and provider symbols', () => {
    const resolver = new InstrumentResolver(CATALOG);

    expect(resolver.resolve('xnas:aapl')).toMatchObject({
      status: 'resolved',
      matchedBy: 'instrument_id',
      instrument: { instrumentId: 'XNAS:AAPL' },
    });
    expect(resolver.resolve('tsla')).toMatchObject({
      status: 'resolved',
      matchedBy: 'symbol',
      instrument: { instrumentId: 'XNAS:TSLA' },
    });
    expect(resolver.resolve('  Tencent  ')).toMatchObject({
      status: 'resolved',
      matchedBy: 'name',
      instrument: { instrumentId: 'XHKG:0700' },
    });
    expect(resolver.resolve('0700.HK')).toMatchObject({
      status: 'resolved',
      matchedBy: 'provider_alias',
      instrument: { instrumentId: 'XHKG:0700' },
    });
    expect(resolver.resolve('aapl', { providerId: 'massive' })).toMatchObject({
      status: 'resolved',
      matchedBy: 'provider_alias',
      instrument: { instrumentId: 'XNAS:AAPL' },
    });
  });

  it('returns ambiguity instead of choosing between dual-listed instruments', () => {
    const resolver = new InstrumentResolver(CATALOG);
    const result = resolver.resolve('Alibaba');

    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.matchedBy).toBe('name');
    expect(result.candidates.map((candidate) => candidate.instrumentId)).toEqual([
      'XNYS:BABA',
      'XHKG:9988',
    ]);
  });

  it('uses a market hint to resolve an otherwise ambiguous company name', () => {
    const resolver = new InstrumentResolver(CATALOG);

    expect(resolver.resolve('Alibaba', { market: 'hk' })).toMatchObject({
      status: 'resolved',
      instrument: { instrumentId: 'XHKG:9988', currency: 'HKD' },
    });
  });

  it('returns not_found for blank, unknown, or wrong-provider input', () => {
    const resolver = new InstrumentResolver(CATALOG);

    expect(resolver.resolve('')).toEqual({ status: 'not_found', query: '' });
    expect(resolver.resolve('NOT-A-SYMBOL')).toEqual({
      status: 'not_found',
      query: 'NOT-A-SYMBOL',
    });
    expect(resolver.resolve('0700.HK', { providerId: 'massive' })).toEqual({
      status: 'not_found',
      query: '0700.HK',
    });
  });

  it('maps one identity to provider-specific symbols', () => {
    expect(getProviderSymbol(APPLE, 'longbridge')).toBe('AAPL.US');
    expect(getProviderSymbol(APPLE, 'MASSIVE')).toBe('AAPL');
    expect(getProviderSymbol(TENCENT, 'massive')).toBeUndefined();
  });

  it('round-trips the provider alias catalog through a versioned snapshot', () => {
    const snapshot = new InstrumentResolver(CATALOG).snapshot(1_789_000_000_000);
    const restored = InstrumentResolver.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));

    expect(snapshot.schemaVersion).toBe(1);
    expect(restored.resolve('BABA.US', { providerId: 'longbridge' })).toMatchObject({
      status: 'resolved',
      instrument: { instrumentId: 'XNYS:BABA' },
    });
  });

  it('rejects duplicate canonical ids and duplicate symbols within a provider namespace', () => {
    expect(() => new InstrumentResolver([APPLE, { ...APPLE }])).toThrow(/Duplicate instrument id/);
    expect(
      () =>
        new InstrumentResolver([
          APPLE,
          {
            ...TESLA,
            providerAliases: [{ providerId: 'massive', symbol: 'AAPL' }],
          },
        ])
    ).toThrow(/Duplicate provider symbol/);
  });
});

describe('createInstrumentId', () => {
  it('normalizes exchange MIC and local symbol', () => {
    expect(createInstrumentId(' xhkg ', ' 0700 ')).toBe('XHKG:0700');
  });
});

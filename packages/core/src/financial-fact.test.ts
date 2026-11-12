import { describe, expect, it } from 'bun:test';
import {
  computeStale,
  convertCurrency,
  describeFact,
  factFreshnessLabel,
  isPriceSeries,
  markUnknown,
  type FinancialFact,
} from './financial-fact.ts';

// Fixed epoch-second anchors so every assertion is deterministic.
const AS_OF = 1_749_000_000; // a "market" timestamp
const RETRIEVED = 1_749_000_002; // 2 seconds later

function fact(overrides: Partial<FinancialFact> = {}): FinancialFact {
  return {
    instrumentId: 'NVDA.US',
    metric: 'lastPrice',
    value: 224.12,
    unit: { kind: 'currency' },
    currency: 'USD',
    asOf: AS_OF,
    retrievedAt: RETRIEVED,
    provider: 'longbridge',
    timing: 'live',
    adjustment: 'raw',
    stale: false,
    ...overrides,
  };
}

describe('computeStale', () => {
  it('flags live data older than 5 minutes as stale', () => {
    const old = AS_OF - 400; // 6m40s old
    expect(computeStale('live', old, { now: AS_OF })).toBe(true);
    expect(computeStale('live', AS_OF - 200, { now: AS_OF })).toBe(false);
  });

  it('flags delayed data older than 15 minutes as stale (delayed ≠ live)', () => {
    // 10 minutes old: fresh for live, stale for delayed.
    const tenMinOld = AS_OF - 600;
    expect(computeStale('delayed', tenMinOld, { now: AS_OF })).toBe(false);
    expect(computeStale('delayed', AS_OF - 1000, { now: AS_OF })).toBe(true);
  });

  it('never flags eod or historical (point-in-time) facts as stale', () => {
    const ancient = AS_OF - 100_000_000;
    expect(computeStale('eod', ancient, { now: AS_OF })).toBe(false);
    expect(computeStale('historical', ancient, { now: AS_OF })).toBe(false);
  });

  it('cannot classify a missing asOf as stale', () => {
    expect(computeStale('live', undefined, { now: AS_OF })).toBe(false);
  });
});

describe('convertCurrency (cross-currency)', () => {
  it('converts value and preserves native value/currency + conversion provenance', () => {
    const usd = fact({ value: 100, currency: 'USD' });
    const hkd = convertCurrency(usd, 'HKD', 7.8, AS_OF, 'open-exchange-rates');

    expect(hkd.value).toBeCloseTo(780);
    expect(hkd.currency).toBe('HKD');
    // native preserved, not lost
    expect(hkd.native).toEqual({ value: 100, currency: 'USD' });
    expect(hkd.fxConversion).toEqual({
      fromCurrency: 'USD',
      toCurrency: 'HKD',
      rate: 7.8,
      rateAsOf: AS_OF,
      source: 'open-exchange-rates',
    });
  });

  it('refuses to convert when there is no native currency', () => {
    const noCurrency = fact({ currency: undefined });
    const out = convertCurrency(noCurrency, 'HKD', 7.8, AS_OF);
    expect(out.value).toBe(noCurrency.value);
    expect(out.unknown).toContain('currency');
    expect(out.fxConversion).toBeUndefined();
  });

  it('refuses a non-positive rate and marks the conversion unknown', () => {
    const out = convertCurrency(fact(), 'HKD', 0, AS_OF);
    expect(out.value).toBe(224.12);
    expect(out.unknown).toContain('fxConversion');
  });
});

describe('isPriceSeries', () => {
  it('is true only when an explicit adjustment is present', () => {
    expect(isPriceSeries(fact({ adjustment: 'raw' }))).toBe(true);
    expect(isPriceSeries(fact({ adjustment: 'unknown' }))).toBe(true);
    expect(isPriceSeries(fact({ adjustment: undefined }))).toBe(false);
  });
});

describe('markUnknown', () => {
  it('records fields explicitly instead of guessing', () => {
    const out = markUnknown(fact(), 'currency', 'asOf');
    expect(out.unknown).toEqual(['currency', 'asOf']);
  });
});

describe('describeFact', () => {
  it('answers what time / currency / basis for a live quote', () => {
    const text = describeFact(fact());
    expect(text).toContain('NVDA.US lastPrice');
    expect(text).toContain('224.12');
    expect(text).toContain('USD');
    expect(text).toContain('live');
    expect(text).toContain('raw');
    expect(text).toContain('as of');
    expect(text).toContain('retrieved');
  });

  it('surfaces a delayed price distinctly from a live one', () => {
    const text = describeFact(fact({ timing: 'delayed', stale: true }));
    expect(text).toContain('delayed');
    expect(text).toContain('stale');
  });

  it('surfaces an FX conversion provenance', () => {
    const converted = convertCurrency(fact(), 'HKD', 7.8, AS_OF);
    const text = describeFact(converted);
    expect(text).toContain('converted USD→HKD @ 7.8');
  });
});

describe('factFreshnessLabel', () => {
  it('derives a machine-readable label for the UI', () => {
    expect(factFreshnessLabel(fact({ timing: 'delayed' }))).toBe('delayed');
    expect(factFreshnessLabel(fact({ timing: 'unknown', stale: true }))).toBe('stale');
    expect(factFreshnessLabel(fact({ timing: 'unknown', stale: false }))).toBe('unknown');
  });
});

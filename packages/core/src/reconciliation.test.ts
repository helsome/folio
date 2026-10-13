import { describe, expect, it } from 'bun:test';
import { reconcileFinancialFacts } from './reconciliation';

const base = { period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' };

describe('reconcileFinancialFacts', () => {
  it('detects material conflict without averaging', () => {
    const r = reconcileFinancialFacts(
      [{ ...base, provider: 'a', value: 100 }, { ...base, provider: 'b', value: 120 }],
      { version: '1', relativeTolerance: 0.03 }
    );
    expect(r.state).toBe('material-conflict');
    expect(r.selected).toBeUndefined();
    expect(r.candidates.map((candidate) => candidate.value)).toEqual([100, 120]);
  });

  it('rejects mismatched semantics', () => {
    expect(
      reconcileFinancialFacts(
        [{ ...base, provider: 'a', value: 1 }, { ...base, provider: 'b', value: 1, period: '2024Q4' }],
        { version: '1' }
      ).state
    ).toBe('incomparable');
  });

  it('accepts tolerance', () => {
    expect(
      reconcileFinancialFacts(
        [{ ...base, provider: 'a', value: 100 }, { ...base, provider: 'b', value: 101 }],
        { version: '1', absoluteTolerance: 2 }
      ).state
    ).toBe('within-tolerance');
  });

  it('uses explicit provider priority without averaging', () => {
    const r = reconcileFinancialFacts(
      [{ ...base, provider: 'fallback', value: 100 }, { ...base, provider: 'primary', value: 130 }],
      { version: '1', providerPriority: ['primary', 'fallback'], relativeTolerance: 0.03 }
    );
    expect(r.state).toBe('material-conflict');
    expect(r.selected?.provider).toBe('primary');
    expect(r.selected?.value).toBe(130);
    expect(r.candidates.map((candidate) => candidate.value)).toEqual([100, 130]);
  });

  it('does not compare different instruments, metrics, or market timestamps', () => {
    const first = { ...base, provider: 'a', instrument: 'AAPL.US', metric: 'lastPrice', value: 100, asOf: 1000 };
    const policy = { version: '2', maxAsOfSkewMs: 60_000 };
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', instrument: 'MSFT.US' }], policy).state)
      .toBe('incomparable');
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', metric: 'high' }], policy).state)
      .toBe('incomparable');
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', asOf: 62_000 }], policy).state)
      .toBe('incomparable');
  });

  it('refuses monetary comparison when currency metadata is absent', () => {
    const r = reconcileFinancialFacts(
      [{ provider: 'a', value: 100 }, { provider: 'b', value: 100 }],
      { version: '2', requireCurrency: true }
    );
    expect(r.state).toBe('incomparable');
    expect(r.selected).toBeUndefined();
  });

  it('matches one fiscal calendar date across vendor time zones but rejects the next date', () => {
    const midnight = Date.UTC(2025, 5, 30);
    const first = { ...base, provider: 'a', value: 100, asOf: midnight };
    const policy = { version: 'fiscal-date/1', maxAsOfSkewMs: 86_400_000, requireAsOfCalendarDate: true };
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', asOf: midnight + 4 * 3_600_000 }], policy).state)
      .toBe('agreement');
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', asOf: midnight + 20 * 3_600_000 }], policy).state)
      .toBe('agreement');
    expect(reconcileFinancialFacts([first, { ...first, provider: 'b', asOf: midnight + 24 * 3_600_000 }], policy).state)
      .toBe('incomparable');
  });

  it('needs two distinct providers rather than two values from one provider', () => {
    const result = reconcileFinancialFacts(
      [{ ...base, provider: 'a', value: 100 }, { ...base, provider: 'a', value: 130 }],
      { version: '2' }
    );
    expect(result.state).toBe('insufficient-sources');
    expect(result.sourceCount).toBe(1);
  });

  it('compares explicit sourced currency and unit conversions without altering raw candidates', () => {
    const asOf = Date.UTC(2025, 5, 30);
    const result = reconcileFinancialFacts([
      { provider: 'usd', value: 1000, currency: 'USD', unit: 'dollars', period: '2025Q2', asOf },
      { provider: 'eur', value: 0.5, currency: 'EUR', unit: 'thousands', period: '2025Q2', asOf },
    ], {
      version: 'fx-rules/1', requireCurrency: true, maxConversionSkewMs: 24 * 60 * 60 * 1000,
      currencyConversions: [{ from: 'EUR', to: 'USD', factor: 2, source: 'fixture FX fixing', asOf }],
      unitConversions: [{ from: 'thousands', to: 'dollars', factor: 1000, source: 'fixture unit scale' }],
    });
    expect(result.state).toBe('agreement');
    expect(result.discrepancy).toBe(0);
    expect(result.candidates.map((candidate) => candidate.value)).toEqual([1000, 0.5]);
    expect(result.normalizations?.[1].comparableValue).toBe(1000);
    expect(result.normalizations?.[1].conversions.map((conversion) => conversion.source))
      .toEqual(['fixture FX fixing', 'fixture unit scale']);
  });

  it('refuses missing, unsourced, or stale currency conversions', () => {
    const asOf = Date.UTC(2025, 5, 30);
    const candidates = [
      { provider: 'usd', value: 100, currency: 'USD', period: '2025Q2', asOf },
      { provider: 'eur', value: 50, currency: 'EUR', period: '2025Q2', asOf },
    ];
    const policy = { version: 'fx-rules/1', requireCurrency: true, maxConversionSkewMs: 86_400_000 };
    expect(reconcileFinancialFacts(candidates, policy).state).toBe('incomparable');
    expect(reconcileFinancialFacts(candidates, {
      ...policy, currencyConversions: [{ from: 'EUR', to: 'USD', factor: 2, source: '', asOf }],
    }).state).toBe('incomparable');
    expect(reconcileFinancialFacts(candidates, {
      ...policy, currencyConversions: [{ from: 'EUR', to: 'USD', factor: 2, source: 'stale fixing', asOf: asOf - 172_800_000 }],
    }).state).toBe('incomparable');
  });
});

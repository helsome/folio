import { describe, expect, it } from 'bun:test';
import type { CalcIndex, Kline, Quote } from './index.ts';
import type { FinancialReport } from './market-data.ts';
import {
  calcIndexToFacts,
  financialReportToFacts,
  klineToFacts,
  marketCurrencyOf,
  quoteToFacts,
} from './financial-fact-factories.ts';

const RETRIEVED = 1_749_000_002;

const quote: Quote = {
  symbol: 'NVDA.US',
  lastPrice: 224.12,
  change: 4.36,
  changePercent: 1.98,
  volume: 123_456_789,
  timestamp: 1_749_000_000,
  high: 226.5,
  low: 221.3,
  open: 221.8,
  prevClose: 219.76,
};

describe('marketCurrencyOf (structured, not free text)', () => {
  it('maps the market code to its native currency', () => {
    expect(marketCurrencyOf('NVDA.US')).toBe('USD');
    expect(marketCurrencyOf('0700.HK')).toBe('HKD');
    expect(marketCurrencyOf('600519.SH')).toBe('CNY');
    expect(marketCurrencyOf('000001.SZ')).toBe('CNY');
    expect(marketCurrencyOf('D05.SG')).toBe('SGD');
  });

  it('returns undefined for unknown markets (never guesses)', () => {
    expect(marketCurrencyOf('UNKNOWN')).toBeUndefined();
    expect(marketCurrencyOf('')).toBeUndefined();
  });
});

describe('quoteToFacts (delayed quote + asOf/retrievedAt separation)', () => {
  it('keeps asOf = data timestamp and retrievedAt = fetch time separate', () => {
    const [lastPrice] = quoteToFacts(quote, {
      currency: 'USD',
      timing: 'delayed',
      retrievedAt: RETRIEVED,
    });
    expect(lastPrice.asOf).toBe(quote.timestamp);
    expect(lastPrice.retrievedAt).toBe(RETRIEVED);
    expect(lastPrice.asOf).not.toBe(lastPrice.retrievedAt);
  });

  it('structurally distinguishes a delayed quote', () => {
    const [lastPrice] = quoteToFacts(quote, { currency: 'USD', timing: 'delayed', retrievedAt: RETRIEVED });
    expect(lastPrice.timing).toBe('delayed');
    expect(lastPrice.stale).toBe(false); // within delayed window at retrievedAt
  });

  it('tags spot price levels as raw and uses structured units', () => {
    const facts = quoteToFacts(quote, { currency: 'USD', retrievedAt: RETRIEVED });
    const byMetric = new Map(facts.map((fact) => [fact.metric, fact]));

    expect(byMetric.get('lastPrice')?.adjustment).toBe('raw');
    expect(byMetric.get('lastPrice')?.unit).toEqual({ kind: 'currency' });
    expect(byMetric.get('lastPrice')?.currency).toBe('USD');
    expect(byMetric.get('changePercent')?.unit).toEqual({ kind: 'percent' });
    expect(byMetric.get('volume')?.unit).toEqual({ kind: 'shares' });
  });

  it('marks currency unknown when no market mapping is available', () => {
    const facts = quoteToFacts({ ...quote, symbol: 'UNKNOWN' }, { retrievedAt: RETRIEVED });
    const lastPrice = facts.find((fact) => fact.metric === 'lastPrice')!;
    expect(lastPrice.currency).toBeUndefined();
    expect(lastPrice.unknown).toContain('currency');
  });
});

describe('klineToFacts (adjustment never silently mixed)', () => {
  const kline: Kline = {
    symbol: 'NVDA.US',
    timestamp: 1_749_000_000,
    open: 220,
    high: 225,
    low: 219,
    close: 224.12,
    volume: 50_000_000,
  };

  it('carries an explicit adjustment on every price fact', () => {
    const facts = klineToFacts(kline, { currency: 'USD', adjustment: 'split-and-dividend-adjusted' });
    const close = facts.find((fact) => fact.metric === 'close')!;
    expect(close.adjustment).toBe('split-and-dividend-adjusted');
    expect(close.unit).toEqual({ kind: 'currency' });
  });

  it('defaults to unknown adjustment rather than assuming raw', () => {
    const facts = klineToFacts(kline, { currency: 'USD' });
    const close = facts.find((fact) => fact.metric === 'close')!;
    expect(close.adjustment).toBe('unknown');
  });

  it('does not tag volume (non-price) with an adjustment', () => {
    const facts = klineToFacts(kline, { currency: 'USD', adjustment: 'raw' });
    const volume = facts.find((fact) => fact.metric === 'volume')!;
    expect(volume.adjustment).toBeUndefined();
    expect(volume.unit).toEqual({ kind: 'shares' });
  });
});

describe('financialReportToFacts (fiscal period + structured currency)', () => {
  const report: FinancialReport = {
    symbol: 'NVDA.US',
    report: 'qf',
    statements: {
      BS: {
        indicators: [
          {
            title: '资产与负债',
            currency: 'USD',
            accounts: [
              {
                field: 'TotalAssets',
                name: '总资产(USD)',
                percent: false,
                values: [
                  { fpEnd: 1_777_176_000, period: 'Q1 2027', year: 2027, value: 259_474_000_000 },
                  { fpEnd: 1_769_317_200, period: 'Q4 2026', year: 2026, value: 206_803_000_000 },
                ],
              },
            ],
          },
        ],
      },
      IS: {
        indicators: [
          {
            title: '盈利能力',
            currency: 'USD',
            accounts: [
              {
                field: 'GrossMargin',
                name: '毛利率',
                percent: true,
                values: [{ fpEnd: 1_777_176_000, period: 'Q1 2027', year: 2027, value: 73.6 }],
              },
            ],
          },
        ],
      },
    },
  };

  it('parses a fiscal period label into a structured period (quarter)', () => {
    const facts = financialReportToFacts(report, { retrievedAt: RETRIEVED });
    const totalAssets = facts.find((fact) => fact.metric === 'TotalAssets' && fact.period?.quarter === 1)!;
    expect(totalAssets.period).toEqual({
      kind: 'quarter',
      year: 2027,
      quarter: 1,
      end: 1_777_176_000,
      label: 'Q1 2027',
    });
  });

  it('uses asOf = fiscal period end and structured currency from the indicator', () => {
    const facts = financialReportToFacts(report, { retrievedAt: RETRIEVED });
    const totalAssets = facts.find((fact) => fact.metric === 'TotalAssets')!;
    expect(totalAssets.asOf).toBe(1_777_176_000);
    expect(totalAssets.currency).toBe('USD');
    expect(totalAssets.unit).toEqual({ kind: 'currency' });
    expect(totalAssets.timing).toBe('historical'); // point-in-time, never stale
  });

  it('uses a percent unit for percent-flagged accounts (no currency)', () => {
    const facts = financialReportToFacts(report, { retrievedAt: RETRIEVED });
    const margin = facts.find((fact) => fact.metric === 'GrossMargin')!;
    expect(margin.unit).toEqual({ kind: 'percent' });
    expect(margin.currency).toBeUndefined();
  });

  it('marks currency unknown when the indicator lacks a structured currency', () => {
    const noCurrency: FinancialReport = {
      symbol: 'UNKNOWN',
      report: 'qf',
      statements: {
        BS: {
          indicators: [
            {
              title: '资产与负债',
              accounts: [
                {
                  field: 'TotalAssets',
                  name: '总资产',
                  percent: false,
                  values: [{ fpEnd: 1_777_176_000, period: 'Q1 2027', year: 2027, value: 100 }],
                },
              ],
            },
          ],
        },
      },
    };
    const facts = financialReportToFacts(noCurrency, { retrievedAt: RETRIEVED });
    expect(facts[0].currency).toBeUndefined();
    expect(facts[0].unknown).toContain('currency');
  });
});

describe('calcIndexToFacts (valuation ratios)', () => {
  const index: CalcIndex = {
    symbol: 'NVDA.US',
    pe: 34.12,
    pb: 27.86,
    dpsRate: 0.12,
    totalMarketValue: 5_445_387_000_000,
    turnoverRate: 0.46,
  };

  it('maps ratios, percents, and currency amounts to structured units', () => {
    const facts = calcIndexToFacts(index, { currency: 'USD', retrievedAt: RETRIEVED });
    const byMetric = new Map(facts.map((fact) => [fact.metric, fact]));
    expect(byMetric.get('pe')?.unit).toEqual({ kind: 'ratio' });
    expect(byMetric.get('pb')?.unit).toEqual({ kind: 'ratio' });
    expect(byMetric.get('dpsRate')?.unit).toEqual({ kind: 'percent' });
    expect(byMetric.get('totalMarketValue')?.unit).toEqual({ kind: 'currency' });
    expect(byMetric.get('totalMarketValue')?.currency).toBe('USD');
    expect(byMetric.get('turnoverRate')?.unit).toEqual({ kind: 'percent' });
  });
});

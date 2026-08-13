import { describe, expect, it } from 'bun:test';
import type { Kline } from '@finagent/core';
import {
  computeEMA,
  computeMA,
  formatBarTime,
  normalizeKlines,
  type FinancialBar,
} from './klineAdapter';

function kline(overrides: Partial<Kline> = {}): Kline {
  return {
    symbol: 'TEST.US',
    timestamp: 1_700_000_000,
    open: 10,
    high: 12,
    low: 8,
    close: 11,
    volume: 1000,
    ...overrides,
  };
}

function bar(close: number): FinancialBar {
  return { timestamp: 0, open: close, high: close, low: close, close };
}

describe('normalizeKlines', () => {
  it('maps fields from Kline to FinancialBar', () => {
    const input: Kline[] = [
      { symbol: 'A.US', timestamp: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 42 },
    ];
    expect(normalizeKlines(input)).toEqual([
      { timestamp: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 42 },
    ]);
  });

  it('omits volume when it is not a finite number', () => {
    const result = normalizeKlines([
      kline({ timestamp: 100, volume: Number.NaN }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].volume).toBeUndefined();
  });

  it('skips rows with non-finite OHLC fields', () => {
    const result = normalizeKlines([
      kline({ timestamp: 1, close: 10 }),
      kline({ timestamp: 2, close: Number.NaN }),
      kline({ timestamp: 3, high: Number.POSITIVE_INFINITY }),
      kline({ timestamp: 4, open: Number.NaN }),
      kline({ timestamp: 5, low: Number.NEGATIVE_INFINITY }),
      kline({ timestamp: 6, close: 20 }),
    ]);
    expect(result.map((b) => b.timestamp)).toEqual([1, 6]);
  });
});

describe('computeMA', () => {
  it('computes a rolling simple moving average with a null prefix', () => {
    const bars = [1, 2, 3, 4, 5].map(bar);
    expect(computeMA(bars, 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns all nulls when period exceeds the sample count', () => {
    const bars = [1, 2].map(bar);
    expect(computeMA(bars, 3)).toEqual([null, null]);
  });

  it('handles a non-positive period defensively', () => {
    const bars = [1, 2, 3].map(bar);
    expect(computeMA(bars, 0)).toEqual([null, null, null]);
  });
});

describe('computeEMA', () => {
  it('seeds from the SMA of the first `period` closes', () => {
    const bars = [2, 4, 8, 16].map(bar);
    const ema = computeEMA(bars, 2);
    // seed = (2 + 4) / 2 = 3; k = 2 / 3
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBe(3);
    expect(ema[2]).toBeCloseTo(19 / 3, 10);
    expect(ema[3]).toBeCloseTo(115 / 9, 10);
  });

  it('returns all nulls when there are not enough samples to seed', () => {
    const bars = [10, 20].map(bar);
    expect(computeEMA(bars, 3)).toEqual([null, null]);
  });
});

describe('no-NaN invariant', () => {
  it('never produces NaN across MA and EMA for arbitrary inputs', () => {
    const bars = [5, 7, 6, 9, 8, 10, 11, 9, 12, 14].map(bar);
    for (const period of [1, 2, 3, 5, 10, 20]) {
      for (const value of computeMA(bars, period)) {
        if (value !== null) expect(Number.isFinite(value)).toBe(true);
      }
      for (const value of computeEMA(bars, period)) {
        if (value !== null) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('handles empty input without NaN', () => {
    expect(computeMA([], 5)).toEqual([]);
    expect(computeEMA([], 5)).toEqual([]);
  });
});

describe('formatBarTime', () => {
  it('formats a compact deterministic UTC date label', () => {
    // 2024-08-13T00:00:00Z
    expect(formatBarTime(1723507200)).toBe('08/13');
  });

  it('returns an empty string for a non-finite timestamp', () => {
    expect(formatBarTime(Number.NaN)).toBe('');
  });
});

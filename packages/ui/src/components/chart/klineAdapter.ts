import type { Kline } from '@finagent/core';

/**
 * Domain bar model shared by the chart layer.
 *
 * Timestamps stay in SECONDS here (matching `@finagent/core`'s `Kline`).
 * klinecharts v10 expects milliseconds, so the conversion happens at the
 * boundary inside the chart wrapper, keeping this module free of any
 * rendering-library knowledge.
 */
export interface FinancialBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Maps raw `Kline` rows to `FinancialBar`s, dropping any row whose OHLC
 * fields are missing or non-finite. `volume` is carried over only when it is
 * a finite number.
 */
export function normalizeKlines(klines: Kline[]): FinancialBar[] {
  const bars: FinancialBar[] = [];
  for (const kline of klines) {
    if (!kline) continue;
    if (
      !isFiniteNumber(kline.timestamp) ||
      !isFiniteNumber(kline.open) ||
      !isFiniteNumber(kline.high) ||
      !isFiniteNumber(kline.low) ||
      !isFiniteNumber(kline.close)
    ) {
      continue;
    }
    const bar: FinancialBar = {
      timestamp: kline.timestamp,
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
    };
    if (isFiniteNumber(kline.volume)) {
      bar.volume = kline.volume;
    }
    bars.push(bar);
  }
  return bars;
}

/**
 * Simple moving average of `close`, one value per bar. Positions before
 * `period` samples have accumulated are `null`.
 */
export function computeMA(bars: FinancialBar[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(bars.length).fill(null);
  if (period <= 0 || bars.length === 0) return result;

  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) {
      sum -= bars[i - period].close;
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

/**
 * Exponential moving average of `close`, seeded with the simple moving
 * average of the first `period` values. Positions before the seed are `null`.
 */
export function computeEMA(bars: FinancialBar[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(bars.length).fill(null);
  if (period <= 0 || bars.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }

  const k = 2 / (period + 1);
  let prev = sum / period;
  result[period - 1] = prev;

  for (let i = period; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/**
 * Compact, deterministic UTC date label (e.g. "08/13") for a timestamp given
 * in seconds. Returns an empty string for non-finite input.
 */
export function formatBarTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

/**
 * Rebased price series (#334 step 1) — deterministic, pure-function contract
 * for normalizing 2–4 instruments' daily bars to a common effective start
 * trading day (base = 100).
 *
 * Rules (mirrors the issue acceptance criteria):
 *   - Base day = the earliest timestamp every valid symbol has a bar for
 *     ("共同有效起始交易日"). Each symbol's close on that day becomes 100.
 *   - The timeline is the union of bar timestamps from the base day onward;
 *     days where a symbol has no bar stay `undefined` (gap) — never zero-filled
 *     and never forward-filled by the computation. Presentation strategies
 *     (gap vs. annotated forward-fill) belong to the UI layer.
 *   - Symbols without usable bars (or with a zero base close) are excluded
 *     from the comparable set and recorded in `detail`, so the caller can
 *     render an explicit "missing" state instead of a fake curve.
 *   - When the valid symbols share no trading day at all, the series is
 *     explicitly non-comparable (`comparable: false`) — a hidden per-symbol
 *     baseline would be dishonest.
 *
 * Callers must pass bars with timestamps aligned to a single trading-day
 * convention (e.g. exchange calendar dates). Bars are deduplicated by
 * timestamp (last one wins) and sorted ascending internally, so provider
 * ordering quirks cannot change the output.
 *
 * Timestamp units pass through unchanged: the Yahoo Finance adapter (#353)
 * emits second-epoch open-time candles (daily and weekly), while other
 * gateways may emit milliseconds — mixing units across symbols in one call
 * yields no shared timestamps and is reported as non-comparable rather than
 * silently rebased. See the Yahoo-shape fixture tests in rebase.test.ts.
 */

export interface RebaseBar {
  timestamp: number;
  close: number;
}

/** Per-symbol rebasing input: bars as produced by the historical-bars gateway. */
export interface RebaseInput {
  symbol: string;
  bars: RebaseBar[];
}

/** symbol → normalized value (base = 100). `undefined` marks a gap on that day. */
export type RebasedValues = Record<string, number | undefined>;

export interface RebasedPoint {
  timestamp: number;
  values: RebasedValues;
}

export interface RebasedSeries {
  comparable: true;
  symbols: string[];
  /**
   * Trading-day epoch every valid symbol's series is normalized to (= 100).
   * The unit passes through the input bars (the Yahoo adapter emits seconds).
   */
  baseTimestamp: number;
  /** symbol → close on `baseTimestamp` (the normalization denominator). */
  baseCloses: Record<string, number>;
  /**
   * symbol → human-readable explanation for symbols excluded from the curve
   * (no usable bars / zero base close). Empty when every symbol is plotted.
   */
  detail: Record<string, string>;
  points: RebasedPoint[];
}

export type RebaseFailureReason = 'empty' | 'no-overlap';

export interface NonComparableSeries {
  comparable: false;
  reason: RebaseFailureReason;
  symbols: string[];
  /** symbol → human-readable explanation, for explicit missing states. */
  detail: Record<string, string>;
}

export type RebaseResult = RebasedSeries | NonComparableSeries;

interface SymbolSeries {
  symbol: string;
  /** Deduplicated, ascending bars. */
  bars: RebaseBar[];
  timestampIndex: Map<number, RebaseBar>;
}

export function buildRebasedPriceSeries(inputs: RebaseInput[]): RebaseResult {
  const series: SymbolSeries[] = [];
  const detail: Record<string, string> = {};

  for (const input of inputs) {
    const bars = normalizeBars(input.bars);
    if (bars.length === 0) {
      detail[input.symbol] = '无有效日线数据';
      continue;
    }
    series.push({
      symbol: input.symbol,
      bars,
      timestampIndex: new Map(bars.map((bar) => [bar.timestamp, bar])),
    });
  }

  const symbols = inputs.map((input) => input.symbol);

  if (series.length === 0) {
    return { comparable: false, reason: 'empty', symbols, detail };
  }

  const baseTimestamp = findCommonStart(series);
  if (baseTimestamp === undefined) {
    return { comparable: false, reason: 'no-overlap', symbols, detail };
  }

  // Symbols whose base close is missing or zero cannot be normalized honestly.
  const valid: SymbolSeries[] = [];
  const baseCloses: Record<string, number> = {};
  for (const entry of series) {
    const baseClose = entry.timestampIndex.get(baseTimestamp)?.close;
    if (baseClose === undefined || baseClose === 0) {
      detail[entry.symbol] = baseClose === 0 ? '基准日收盘价为 0，无法归一化' : '基准日缺 bar，无法归一化';
      continue;
    }
    valid.push(entry);
    baseCloses[entry.symbol] = baseClose;
  }

  if (valid.length === 0) {
    return { comparable: false, reason: 'empty', symbols, detail };
  }

  return {
    comparable: true,
    symbols,
    baseTimestamp,
    baseCloses,
    detail,
    points: buildPoints(valid, baseTimestamp, baseCloses),
  };
}

/**
 * Sort ascending and drop duplicate timestamps, keeping the last bar.
 * Non-finite timestamps/closes (malformed provider data) are dropped rather
 * than poisoning the curve with NaN points.
 */
function normalizeBars(bars: RebaseBar[]): RebaseBar[] {
  const byTimestamp = new Map<number, RebaseBar>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.timestamp) || !Number.isFinite(bar.close)) continue;
    byTimestamp.set(bar.timestamp, bar);
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Earliest timestamp present in every symbol's bar set, or `undefined` when the
 * trading calendars do not overlap at all.
 */
function findCommonStart(series: SymbolSeries[]): number | undefined {
  const [first, ...rest] = series;
  for (const bar of first.bars) {
    const shared = rest.every((entry) => entry.timestampIndex.has(bar.timestamp));
    if (shared) return bar.timestamp;
  }
  return undefined;
}

/**
 * Timeline = union of timestamps from the base day onward. A symbol without a
 * bar on a timeline day keeps `undefined` at that point (gap, never 0).
 */
function buildPoints(
  valid: SymbolSeries[],
  baseTimestamp: number,
  baseCloses: Record<string, number>
): RebasedPoint[] {
  const timeline = new Set<number>();
  for (const entry of valid) {
    for (const bar of entry.bars) {
      if (bar.timestamp >= baseTimestamp) timeline.add(bar.timestamp);
    }
  }

  return [...timeline]
    .sort((a, b) => a - b)
    .map((timestamp) => {
      const values: RebasedValues = {};
      for (const entry of valid) {
        const bar = entry.timestampIndex.get(timestamp);
        values[entry.symbol] =
          bar === undefined ? undefined : (bar.close / baseCloses[entry.symbol]) * 100;
      }
      return { timestamp, values };
    });
}

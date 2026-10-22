import { describe, expect, it } from 'bun:test';
import {
  buildRebasedPriceSeries,
  type RebaseBar,
  type RebaseInput,
} from './rebase.ts';

const DAY = 86_400_000;

/** `count` daily bars starting at `start` (ms epoch), close from `closes`. */
function bars(start: number, count: number, closes: number[]): RebaseBar[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: start + i * DAY,
    close: closes[i] ?? closes[closes.length - 1],
  }));
}

function linearBars(start: number, count: number, first: number, step: number): RebaseBar[] {
  return bars(
    start,
    count,
    Array.from({ length: count }, (_, i) => first + i * step)
  );
}

/** Bars missing the given day offsets (0-based from `start`). */
function withoutDays(source: RebaseBar[], offsets: number[]): RebaseBar[] {
  const skip = new Set(offsets);
  return source.filter((_, i) => !skip.has(i));
}

function input(symbol: string, bars: RebaseBar[]): RebaseInput {
  return { symbol, bars };
}

describe('buildRebasedPriceSeries', () => {
  it('normalizes fully overlapping calendars with the shared first day as base', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 5, 100, 1); // 100,101,...,104
    const b = linearBars(start, 5, 200, 2); // 200,202,...,208

    const result = buildRebasedPriceSeries([input('A.US', a), input('B.US', b)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.baseTimestamp).toBe(start);
    expect(result.baseCloses).toEqual({ 'A.US': 100, 'B.US': 200 });
    expect(result.points).toHaveLength(5);

    const first = result.points[0];
    expect(first.timestamp).toBe(start);
    expect(first.values['A.US']).toBe(100);
    expect(first.values['B.US']).toBe(100);

    const last = result.points[4];
    expect(last.values['A.US']).toBeCloseTo(104, 10);
    expect(last.values['B.US']).toBeCloseTo(104, 10);
  });

  it('uses the latest listing date as base when listing dates differ', () => {
    const start = 1_700_000_000;
    const early = linearBars(start, 10, 50, 1); // lists on day 0
    const late = linearBars(start + 5 * DAY, 5, 300, 0); // lists on day 5

    const result = buildRebasedPriceSeries([input('EARLY.US', early), input('LATE.US', late)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    // 共同有效起始交易日 = day 5；EARLY 的基准 close 是它在 day 5 的 55。
    expect(result.baseTimestamp).toBe(start + 5 * DAY);
    expect(result.baseCloses).toEqual({ 'EARLY.US': 55, 'LATE.US': 300 });
    // Day-0 至 day-4 不在曲线上：归一化不回填上市前数据。
    expect(result.points[0].timestamp).toBe(start + 5 * DAY);
    expect(result.points).toHaveLength(5);
    expect(result.points[4].values['EARLY.US']).toBeCloseTo((59 / 55) * 100, 10);
  });

  it('keeps calendar gaps as undefined instead of zero- or forward-filling', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 5, 100, 0);
    const b = withoutDays(linearBars(start, 5, 100, 0), [1, 3]); // misses day 1 and 3

    const result = buildRebasedPriceSeries([input('A.US', a), input('B.US', b)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.points).toHaveLength(5);
    const day1 = result.points[1];
    expect(day1.values['A.US']).toBe(100);
    // 缺值不补零：B 在 day 1、day 3 是 gap。
    expect(day1.values['B.US']).toBeUndefined();
    expect(result.points[3].values['B.US']).toBeUndefined();
    // 周边点仍然有值。
    expect(result.points[2].values['B.US']).toBe(100);
    expect(result.points[4].values['B.US']).toBe(100);
  });

  it('reflects a raw-price split jump honestly instead of smoothing it', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 4, 100, 0);
    // B 拆股（2:1），raw 价格 day 2 从 100 → 50。
    const b = bars(start, 4, [100, 100, 50, 50]);

    const result = buildRebasedPriceSeries([input('A.US', a), input('B.US', b)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.points[2].values['B.US']).toBe(50);
    expect(result.points[3].values['B.US']).toBe(50);
    // 归一化层不虚构复权：跳变保留，展示层负责标注复权类型。
    expect(result.points[3].values['A.US']).toBe(100);
  });

  it('sorts unsorted bars and lets the last bar win on duplicate timestamps', () => {
    const start = 1_700_000_000;
    const descending = [
      { timestamp: start + 2 * DAY, close: 300 },
      { timestamp: start, close: 100 },
      { timestamp: start + DAY, close: 200 },
    ];
    const duplicates = [
      { timestamp: start, close: 100 },
      { timestamp: start, close: 999 }, // same-day correction wins
      { timestamp: start + DAY, close: 100 },
      { timestamp: start + 2 * DAY, close: 100 },
    ];

    const result = buildRebasedPriceSeries([
      input('A.US', descending),
      input('B.US', duplicates),
    ]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.baseTimestamp).toBe(start);
    expect(result.baseCloses).toEqual({ 'A.US': 100, 'B.US': 999 });
    expect(result.points.map((p) => p.timestamp)).toEqual([
      start,
      start + DAY,
      start + 2 * DAY,
    ]);
  });

  it('excludes symbols without bars from the curve and records why', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 3, 100, 0);

    const result = buildRebasedPriceSeries([
      input('A.US', a),
      input('EMPTY.US', []),
    ]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.symbols).toEqual(['A.US', 'EMPTY.US']);
    expect(result.detail['EMPTY.US']).toBeDefined();
    expect(result.points[0].values['EMPTY.US']).toBeUndefined();
    expect(result.points[0].values['A.US']).toBe(100);
  });

  it('excludes symbols whose base close is zero (division guard)', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 3, 100, 0);
    const b = linearBars(start, 3, 0, 0); // degenerate zero closes

    const result = buildRebasedPriceSeries([input('A.US', a), input('B.US', b)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.detail['B.US']).toBeDefined();
    expect(result.points[2].values['B.US']).toBeUndefined();
    expect(result.points[2].values['A.US']).toBe(100);
  });

  it('reports empty when no symbol has usable bars', () => {
    const result = buildRebasedPriceSeries([
      input('A.US', []),
      input('B.US', bars(1, 1, [NaN as unknown as number])),
    ]);

    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.reason).toBe('empty');
    expect(Object.keys(result.detail)).toContain('A.US');
  });

  it('reports no-overlap when the trading calendars never intersect', () => {
    const start = 1_700_000_000;
    const a = linearBars(start, 3, 100, 0);           // days 0-2
    const b = linearBars(start + 10 * DAY, 3, 100, 0); // days 10-12

    const result = buildRebasedPriceSeries([input('A.US', a), input('B.US', b)]);

    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.reason).toBe('no-overlap');
  });

  it('reports empty for an empty input list', () => {
    const result = buildRebasedPriceSeries([]);

    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.reason).toBe('empty');
    expect(result.symbols).toEqual([]);
  });
});

/**
 * Yahoo Finance adapter (#353) shape compatibility — offline fixtures only,
 * isomorphic to what `mapKlines` in providers/yahoo/adapter.ts emits:
 *   - second-epoch open-time timestamps (e.g. 14:30 UTC = 9:30 ET open),
 *   - bars whose OHLC is null (halted/missing sessions) are skipped upstream,
 *   - ascending order, `volume` absent from this contract.
 *
 * These fixtures assert timestamp pass-through, common effective start, and
 * gap preservation against that exact shape; they never hit the network.
 */
describe('buildRebasedPriceSeries: Yahoo Finance kline shape', () => {
  const SESSION = 86_400; // seconds
  // 2023-11-08 (Wed) 14:30 UTC — same open-time convention as the
  // providers/yahoo/yahoo.test.ts chart fixtures.
  const WED = 1_699_472_640;
  const THU = WED + SESSION;
  const FRI = THU + SESSION;
  // Weekend skip: the next session is Monday.
  const MON = FRI + 3 * SESSION;
  const TUE = MON + SESSION;

  function yahooBars(timestamps: number[], closes: number[]): RebaseBar[] {
    return timestamps.map((timestamp, i) => ({ timestamp, close: closes[i] }));
  }

  it('rebases Yahoo daily candles with second-epoch open-time timestamps', () => {
    // AAPL has bars all week; NVDA's first bar lands on Friday.
    const aapl = yahooBars([WED, THU, FRI, MON, TUE], [189, 190.2, 188, 191, 192]);
    const nvda = yahooBars([FRI, MON, TUE], [475, 480, 470]);

    const result = buildRebasedPriceSeries([input('AAPL.US', aapl), input('NVDA.US', nvda)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    // Timestamp pass-through: base/point timestamps keep the input's
    // second-epoch values — no unit conversion, no rounding, no shift.
    expect(result.baseTimestamp).toBe(FRI);
    expect(result.baseCloses).toEqual({ 'AAPL.US': 188, 'NVDA.US': 475 });
    expect(result.points.map((p) => p.timestamp)).toEqual([FRI, MON, TUE]);
    expect(result.points[0].values).toEqual({ 'AAPL.US': 100, 'NVDA.US': 100 });
    expect(result.points[2].values['AAPL.US']).toBeCloseTo((192 / 188) * 100, 10);
    expect(result.points[2].values['NVDA.US']).toBeCloseTo((470 / 475) * 100, 10);
  });

  it('keeps Yahoo null-OHLC skips as gaps instead of zero- or forward-filling', () => {
    // In raw Yahoo responses, halted/missing sessions carry null OHLC and
    // `mapKlines` drops those bars entirely: MSFT simply has no bar on THU
    // and TUE. The rebased curve must keep those days `undefined`.
    const aapl = yahooBars([WED, THU, FRI, MON, TUE], [189, 190.2, 188, 191, 192]);
    const msft = yahooBars([WED, FRI, MON], [370, 372, 371]);

    const result = buildRebasedPriceSeries([input('AAPL.US', aapl), input('MSFT.US', msft)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.baseTimestamp).toBe(WED);
    expect(result.points.map((p) => p.timestamp)).toEqual([WED, THU, FRI, MON, TUE]);
    // Gaps stay undefined — a missing Yahoo bar is never 0 or the last close.
    expect(result.points[1].values['MSFT.US']).toBeUndefined();
    expect(result.points[4].values['MSFT.US']).toBeUndefined();
    // Sessions with a bar normalize as usual.
    expect(result.points[2].values['MSFT.US']).toBeCloseTo((372 / 370) * 100, 10);
  });

  it('rebases Yahoo weekly candles on the same second-epoch grid', () => {
    // interval=1wk: timestamps are each week's first session open
    // (Monday 14:30 UTC), one week = 604800 seconds apart.
    const WEEK = 7 * SESSION;
    const W1 = 1_699_299_840; // 2023-11-06 (Mon) 14:30 UTC
    const aapl = yahooBars([W1, W1 + WEEK, W1 + 2 * WEEK], [189, 193, 190]);
    const msft = yahooBars([W1, W1 + 2 * WEEK], [370, 373]); // misses week 2

    const result = buildRebasedPriceSeries([input('AAPL.US', aapl), input('MSFT.US', msft)]);

    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.baseTimestamp).toBe(W1);
    expect(result.points.map((p) => p.timestamp)).toEqual([W1, W1 + WEEK, W1 + 2 * WEEK]);
    expect(result.points[1].values['MSFT.US']).toBeUndefined();
    expect(result.points[2].values['MSFT.US']).toBeCloseTo((373 / 370) * 100, 10);
    expect(result.points[2].values['AAPL.US']).toBeCloseTo((190 / 189) * 100, 10);
  });

  it('reports no-overlap when timestamp units are mixed across symbols', () => {
    // Defense for the unit-passthrough contract: a second-epoch Yahoo feed
    // mixed with a millisecond-epoch feed shares no timestamp, so the series
    // is reported non-comparable instead of being silently rebased.
    const secondsFeed = yahooBars([WED, THU, FRI], [189, 190.2, 188]);
    const millisFeed = yahooBars([WED * 1000, THU * 1000, FRI * 1000], [370, 372, 371]);

    const result = buildRebasedPriceSeries([
      input('AAPL.US', secondsFeed),
      input('MSFT.US', millisFeed),
    ]);

    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.reason).toBe('no-overlap');
  });
});

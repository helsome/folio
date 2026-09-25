import { describe, expect, it } from 'bun:test';
import type { MarketDataFetchers } from './market-data-service.ts';
import { withDemoDataFallback } from './demo-market-data.ts';

/**
 * Regression coverage for the offline demo market data (`FINAGENT_DEMO_DATA=1`).
 *
 * `demoKlinesFor` documents itself as a "deterministic daily close series
 * **ending at** the demo quote's last price", and the real provider path it
 * stands in for returns bars oldest→newest with the newest bar at `slice(-limit)`
 * (see `@finagent/longbridge-tools` `getKline`). The series must therefore walk
 * backwards **from** the current quote: the last element is "today".
 */

type DemoFetchers = Partial<MarketDataFetchers>;

function demoFetchers() {
  return withDemoDataFallback<DemoFetchers>({});
}

async function series(symbol: string, limit: number) {
  const fetchers = demoFetchers();
  const quote = await fetchers.getQuote!(symbol);
  const klines = await fetchers.getKline!({ symbol, period: '1d', limit });
  return { quote, klines };
}

describe('demo market data kline series', () => {
  it('ends the series at the demo quote last price', async () => {
    for (const symbol of ['AAPL.US', 'TSLA.US', 'NVDA.US', 'MSFT.US']) {
      for (const limit of [2, 30, 120]) {
        const { quote, klines } = await series(symbol, limit);
        expect(klines).toHaveLength(limit);
        expect(klines[klines.length - 1]!.close).toBe(quote.lastPrice);
      }
    }
  });

  it('does not place the current quote price on the oldest bar', async () => {
    const { quote, klines } = await series('AAPL.US', 30);

    // The series walks back from today, so the oldest bar must have drifted away.
    expect(klines[0]!.close).not.toBe(quote.lastPrice);
    expect(Math.abs(klines[0]!.close - quote.lastPrice)).toBeGreaterThan(0);
  });

  it('keeps the series ordered oldest to newest on a one-day grid', async () => {
    const { klines } = await series('AAPL.US', 30);

    const timestamps = klines.map((kline) => kline.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]! - timestamps[index - 1]!).toBe(86_400);
    }
  });

  it('keeps every bar internally consistent', async () => {
    const { klines } = await series('NVDA.US', 60);

    for (const kline of klines) {
      expect(kline.high).toBeGreaterThanOrEqual(Math.max(kline.open, kline.close));
      expect(kline.low).toBeLessThanOrEqual(Math.min(kline.open, kline.close));
      expect(kline.volume).toBeGreaterThan(0);
    }
  });

  it('clamps the requested limit to the documented 2..400 window', async () => {
    const low = await series('AAPL.US', 1);
    expect(low.klines).toHaveLength(2);

    const high = await series('AAPL.US', 9_999);
    expect(high.klines).toHaveLength(400);
  });
});

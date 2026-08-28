import { describe, expect, it } from 'bun:test';
import {
  demoCalendarEvents,
  demoDailyBrief,
  demoPortfolioSnapshot,
  demoQuote,
  hasDemoQuote,
} from './demoData';
import { makeTestI18n } from '../test/i18nTest';

const i18n = makeTestI18n('en-US');
const t = ((key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'translation', ...options })) as never;

const NOW = Date.now();

describe('demoQuote', () => {
  it('returns null for unknown symbols', () => {
    expect(demoQuote('0700.HK', NOW)).toBeNull();
    expect(hasDemoQuote('0700.HK')).toBe(false);
  });

  it('builds an internally consistent quote', () => {
    const quote = demoQuote('AAPL.US', NOW)!;
    expect(quote.symbol).toBe('AAPL.US');
    expect(quote.lastPrice).toBe(189.43);
    expect(quote.changePercent).toBeCloseTo(1.2, 5);
    // change + prevClose must reconcile with lastPrice.
    expect(quote.prevClose + quote.change).toBeCloseTo(quote.lastPrice, 2);
    expect(quote.high).toBeGreaterThanOrEqual(quote.lastPrice);
    expect(quote.low).toBeLessThanOrEqual(quote.open);
    expect(Number.isFinite(quote.volume)).toBe(true);
    // Timestamp is epoch seconds (core convention).
    expect(quote.timestamp).toBe(Math.floor(NOW / 1000));
  });

  it('marks down moves with a negative change', () => {
    const quote = demoQuote('TSLA.US', NOW)!;
    expect(quote.changePercent).toBeLessThan(0);
    expect(quote.change).toBeLessThan(0);
  });
});

describe('demoPortfolioSnapshot', () => {
  it('produces a consistent snapshot', () => {
    const snapshot = demoPortfolioSnapshot(NOW);
    expect(snapshot.baseCurrency).toBe('USD');
    expect(snapshot.holdings.length).toBe(4);

    const marketValue = snapshot.holdings.reduce(
      (sum, holding) => sum + (holding.marketValue ?? 0),
      0,
    );
    expect(snapshot.marketValue).toBeCloseTo(marketValue, 2);
    expect(snapshot.totalAssets).toBeCloseTo(marketValue + (snapshot.cash ?? 0), 2);

    const totalPnL = snapshot.holdings.reduce(
      (sum, holding) => sum + (holding.unrealizedPnL ?? 0),
      0,
    );
    expect(snapshot.totalPnL).toBeCloseTo(totalPnL, 2);

    // Every holding reconciles: value = price × qty, pnl = value − cost.
    for (const holding of snapshot.holdings) {
      expect(holding.marketValue).toBeCloseTo((holding.marketPrice ?? 0) * (holding.quantity ?? 0), 2);
      expect(holding.unrealizedPnL).toBeCloseTo(
        (holding.marketValue ?? 0) - (holding.costPrice ?? 0) * (holding.quantity ?? 0),
        2,
      );
    }
  });

  it('accounts sum to the snapshot totals', () => {
    const snapshot = demoPortfolioSnapshot(NOW);
    expect(snapshot.accounts.length).toBe(1);
    expect(snapshot.accounts[0].netAssets).toBe(snapshot.totalAssets);
  });
});

describe('demoCalendarEvents', () => {
  it('returns future-only localized events', () => {
    const events = demoCalendarEvents(t, NOW);
    expect(events.length).toBeGreaterThanOrEqual(3);
    const nowSeconds = Math.floor(NOW / 1000);
    for (const event of events) {
      expect(event.date).toBeGreaterThan(nowSeconds);
      expect(typeof event.name).toBe('string');
      expect((event.name ?? '').length).toBeGreaterThan(0);
      expect(event.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Sorted ascending by date.
    const dates = events.map((event) => event.date);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });
});

describe('demoDailyBrief', () => {
  it('returns a localized brief with two headline items', () => {
    const brief = demoDailyBrief(t, NOW);
    expect(brief.items.length).toBe(2);
    expect(brief.generatedAt).toBe(NOW);
    for (const item of brief.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(['info', 'warning', 'critical']).toContain(item.severity);
      expect(['Portfolio', 'Watchlist', 'Thesis', 'Alert', 'Automation']).toContain(item.source);
    }
    expect(brief.quiet.count).toBeGreaterThanOrEqual(0);
  });
});

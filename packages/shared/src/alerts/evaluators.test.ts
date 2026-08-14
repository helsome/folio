import { describe, expect, it } from 'bun:test';
import type { AlertRule, AlertRuleBase, Quote } from '@finagent/core';
import { evaluateRule } from './evaluators.ts';
import { base, makeRegistry, makeSnapshotContext } from './testing.ts';

const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;
const DAY_S = 86_400;

function now() {
  return NOW_MS;
}

function makeQuote(lastPrice: number): Quote {
  return {
    symbol: 'NVDA.US',
    lastPrice,
    change: 0,
    changePercent: 0,
    volume: 0,
    timestamp: NOW_S,
    high: lastPrice,
    low: lastPrice,
    open: lastPrice,
    prevClose: lastPrice,
  };
}

function rule(baseFields: Partial<AlertRuleBase>, rest: object): AlertRule {
  return { ...base(baseFields), ...rest } as AlertRule;
}

describe('price_above', () => {
  it('triggers when last price crosses above target', async () => {
    const registry = makeRegistry({ 'market.quote': makeQuote(150) });
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_above', targetPrice: 100 });
    const event = await evaluateRule(r, registry, { now });
    expect(event).not.toBeNull();
    expect(event?.payload).toEqual({ price: 150, targetPrice: 100 });
  });

  it('does not trigger below target', async () => {
    const registry = makeRegistry({ 'market.quote': makeQuote(90) });
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_above', targetPrice: 100 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null when the quote capability is missing', async () => {
    const registry = makeRegistry({});
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_above', targetPrice: 100 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('price_below', () => {
  it('triggers when last price crosses below target', async () => {
    const registry = makeRegistry({ 'market.quote': makeQuote(80) });
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_below', targetPrice: 100 });
    const event = await evaluateRule(r, registry, { now });
    expect(event?.payload).toEqual({ price: 80, targetPrice: 100 });
  });

  it('does not trigger above target', async () => {
    const registry = makeRegistry({ 'market.quote': makeQuote(120) });
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_below', targetPrice: 100 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null on empty quote result', async () => {
    const registry = makeRegistry({ 'market.quote': null });
    const r = rule({}, { symbol: 'NVDA.US', type: 'price_below', targetPrice: 100 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('new_news', () => {
  it('triggers for items newer than the cursor (max 3)', async () => {
    const registry = makeRegistry({
      'research.news': [
        { id: 'a', title: 'Alpha', summary: '', url: '', timestamp: NOW_S - 60, symbols: [] },
        { id: 'b', title: 'Beta', summary: '', url: '', timestamp: NOW_S + 60, symbols: [] },
      ],
    });
    const r = rule({ lastCheckedAt: NOW_MS }, { symbol: 'NVDA.US', type: 'new_news' });
    const event = await evaluateRule(r, registry, { now });
    expect(event).not.toBeNull();
    expect(event?.payload).toEqual({ items: [{ id: 'b', title: 'Beta' }] });
  });

  it('does not trigger when every item is older than the cursor', async () => {
    const registry = makeRegistry({
      'research.news': [
        { id: 'a', title: 'Alpha', summary: '', url: '', timestamp: NOW_S - 60, symbols: [] },
      ],
    });
    const r = rule({ lastCheckedAt: NOW_MS }, { symbol: 'NVDA.US', type: 'new_news' });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null on empty news', async () => {
    const registry = makeRegistry({ 'research.news': [] });
    const r = rule({}, { symbol: 'NVDA.US', type: 'new_news' });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('earnings', () => {
  it('triggers for an earnings event within the horizon', async () => {
    const registry = makeRegistry({
      'research.events': [
        { date: NOW_S + 2 * DAY_S, type: 'financial', symbol: 'NVDA.US' },
      ],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'earnings', horizonDays: 7 });
    const event = await evaluateRule(r, registry, { now });
    expect(event).not.toBeNull();
    expect((event?.payload?.date as number)).toBe((NOW_S + 2 * DAY_S) * 1000);
  });

  it('does not trigger for events outside the horizon', async () => {
    const registry = makeRegistry({
      'research.events': [
        { date: NOW_S + 30 * DAY_S, type: 'financial', symbol: 'NVDA.US' },
      ],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'earnings', horizonDays: 7 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null when no events match', async () => {
    const registry = makeRegistry({ 'research.events': [] });
    const r = rule({}, { symbol: 'NVDA.US', type: 'earnings', horizonDays: 7 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('rating_change', () => {
  it('triggers when the rating summary changes across two observations', async () => {
    const registry = makeRegistry({ 'company.ratings': { recommend: 'strong_buy', target: 302 } });
    const r = rule({}, { symbol: 'NVDA.US', type: 'rating_change' });
    const snapshots = makeSnapshotContext();
    // First observation: baseline, no trigger.
    expect(await evaluateRule(r, registry, { now, ...snapshots })).toBeNull();

    // Second observation with a changed rating.
    const registry2 = makeRegistry({ 'company.ratings': { recommend: 'hold', target: 280 } });
    const event = await evaluateRule(r, registry2, { now, ...snapshots });
    expect(event).not.toBeNull();
    expect(event?.payload).toEqual({ previous: 'strong_buy@302', current: 'hold@280' });
  });

  it('does not trigger when the rating is unchanged', async () => {
    const registry = makeRegistry({ 'company.ratings': { recommend: 'buy', target: 300 } });
    const r = rule({}, { symbol: 'NVDA.US', type: 'rating_change' });
    const snapshots = makeSnapshotContext({ [r.id]: { ratingSummary: 'buy@300' } });
    expect(await evaluateRule(r, registry, { now, ...snapshots })).toBeNull();
  });

  it('returns null when the ratings capability is missing', async () => {
    const registry = makeRegistry({});
    const r = rule({}, { symbol: 'NVDA.US', type: 'rating_change' });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('dividend', () => {
  it('triggers for an ex-dividend date within 7 days', async () => {
    const registry = makeRegistry({
      'company.dividends': [{ exDate: NOW_S + 3 * DAY_S }],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'dividend' });
    const event = await evaluateRule(r, registry, { now });
    expect(event).not.toBeNull();
    expect(event?.payload?.exDate).toBe((NOW_S + 3 * DAY_S) * 1000);
  });

  it('does not trigger for a far-future or past ex-date', async () => {
    const registry = makeRegistry({
      'company.dividends': [{ exDate: NOW_S - DAY_S }, { exDate: NOW_S + 30 * DAY_S }],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'dividend' });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null on empty dividend history', async () => {
    const registry = makeRegistry({ 'company.dividends': [] });
    const r = rule({}, { symbol: 'NVDA.US', type: 'dividend' });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('position_weight', () => {
  function portfolio(totalValue: number, marketValue: number): object {
    return {
      totalValue,
      cash: 0,
      positions: [{ symbol: 'NVDA.US', name: 'Nvidia', quantity: 1, avgCost: 0, lastPrice: 0, marketValue, unrealizedPnL: 0, unrealizedPnLPercent: 0 }],
    };
  }

  it('triggers when weight leaves [minWeight, maxWeight]', async () => {
    const registry = makeRegistry({
      'portfolio.summary': portfolio(1000, 400),
      'portfolio.positions': [{ symbol: 'NVDA.US', quantity: 1 }],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'position_weight', minWeight: 0.1, maxWeight: 0.3 });
    const event = await evaluateRule(r, registry, { now });
    expect(event).not.toBeNull();
    expect(event?.payload?.weight).toBeCloseTo(0.4);
  });

  it('does not trigger when weight is within bounds', async () => {
    const registry = makeRegistry({
      'portfolio.summary': portfolio(1000, 200),
      'portfolio.positions': [{ symbol: 'NVDA.US', quantity: 1 }],
    });
    const r = rule({}, { symbol: 'NVDA.US', type: 'position_weight', minWeight: 0.1, maxWeight: 0.3 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });

  it('returns null when the portfolio is empty', async () => {
    const registry = makeRegistry({ 'portfolio.summary': null, 'portfolio.positions': [] });
    const r = rule({}, { symbol: 'NVDA.US', type: 'position_weight', minWeight: 0.1, maxWeight: 0.3 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('portfolio_drawdown', () => {
  it('triggers when drawdown exceeds the threshold', async () => {
    const registry = makeRegistry({ 'portfolio.summary': { totalValue: 80, cash: 0, positions: [] } });
    const r = rule({}, { type: 'portfolio_drawdown', threshold: 0.1 });
    const snapshots = makeSnapshotContext({ [r.id]: { peakValue: 100 } });
    const event = await evaluateRule(r, registry, { now, ...snapshots });
    expect(event).not.toBeNull();
    expect(event?.payload?.drawdown).toBeCloseTo(0.2);
    expect(event?.payload?.peak).toBe(100);
  });

  it('does not trigger below the threshold (and resets peak on a new high)', async () => {
    const registry = makeRegistry({ 'portfolio.summary': { totalValue: 95, cash: 0, positions: [] } });
    const r = rule({}, { type: 'portfolio_drawdown', threshold: 0.1 });
    const snapshots = makeSnapshotContext({ [r.id]: { peakValue: 100 } });
    expect(await evaluateRule(r, registry, { now, ...snapshots })).toBeNull();
  });

  it('returns null when the portfolio is missing', async () => {
    const registry = makeRegistry({});
    const r = rule({}, { type: 'portfolio_drawdown', threshold: 0.1 });
    expect(await evaluateRule(r, registry, { now })).toBeNull();
  });
});

describe('evaluateRule dispatch', () => {
  it('covers every ALERT_RULE_TYPES member without throwing', async () => {
    const types: AlertRule['type'][] = [
      'price_above',
      'price_below',
      'new_news',
      'earnings',
      'rating_change',
      'dividend',
      'position_weight',
      'portfolio_drawdown',
    ];
    const registry = makeRegistry({});
    for (const type of types) {
      const extra =
        type === 'portfolio_drawdown'
          ? { threshold: 0.1 }
          : type === 'earnings'
          ? { horizonDays: 7 }
          : type === 'price_above' || type === 'price_below'
          ? { targetPrice: 100 }
          : {};
      const r = rule({}, { symbol: 'NVDA.US', type, ...extra });
      // Missing capabilities → all return null (never throw).
      expect(await evaluateRule(r, registry, { now })).toBeNull();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlertRule, AlertTriggerEvent, MarketStatus, Quote } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { AlertEngine } from './engine.ts';
import { AlertEventLog } from './events.ts';
import { AlertRuleRepository } from './rules-repository.ts';
import { fakeCap, failingCap, makeRegistry } from './testing.ts';

function tempStore(): JsonFileStore {
  return new JsonFileStore(mkdtempSync(join(tmpdir(), 'folio-alerts-')));
}

function openStatus(market = 'US'): MarketStatus[] {
  return [{ market, status: 'Trading' }];
}

function makeQuote(lastPrice: number): Quote {
  return {
    symbol: 'NVDA.US',
    lastPrice,
    change: 0,
    changePercent: 0,
    volume: 0,
    timestamp: 1_700_000_000,
    high: lastPrice,
    low: lastPrice,
    open: lastPrice,
    prevClose: lastPrice,
  };
}

function priceRule(id: string, targetPrice: number, cooldownMinutes = 0): AlertRule {
  return {
    id,
    createdAt: 0,
    enabled: true,
    cooldownMinutes,
    symbol: 'NVDA.US',
    type: 'price_above',
    targetPrice,
  };
}

describe('AlertEngine cooldown', () => {
  it('fires once, then skips within the cooldown window', async () => {
    const store = tempStore();
    let nowMs = 1000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    await repository.save(priceRule('r1', 100, 30));

    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry: makeRegistry({
        'market.quote': makeQuote(150),
        'market.status': openStatus(),
      }),
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick();
    expect(events.length).toBe(1);

    nowMs += 60_000; // still inside the 30-minute cooldown
    await engine.tick();
    expect(events.length).toBe(1);

    nowMs += 31 * 60_000; // past cooldown
    await engine.tick();
    expect(events.length).toBe(2);
  });
});

describe('AlertEngine dedup', () => {
  it('new_news only fires for items newer than the cursor', async () => {
    const store = tempStore();
    let nowMs = 1_700_000_000_000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    const newsRule: AlertRule = {
      id: 'news-1',
      createdAt: 0,
      enabled: true,
      cooldownMinutes: 0,
      symbol: 'NVDA.US',
      type: 'new_news',
    };
    await repository.save(newsRule);

    let items = [
      { id: 'a', title: 'Alpha', summary: '', url: '', timestamp: nowMs / 1000 - 60, symbols: [] },
    ];
    const registry = makeRegistry({
      'research.news': () => items,
      'market.status': openStatus(),
    });
    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry,
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick();
    expect(events.length).toBe(1);

    nowMs += 60_000; // cursor advanced past the old item
    await engine.tick();
    expect(events.length).toBe(1);

    items = [
      { id: 'a', title: 'Alpha', summary: '', url: '', timestamp: nowMs / 1000 - 60, symbols: [] },
      { id: 'b', title: 'Bravo', summary: '', url: '', timestamp: nowMs / 1000 + 60, symbols: [] },
    ];
    await engine.tick();
    expect(events.length).toBe(2);
    expect(events[1].payload).toEqual({ items: [{ id: 'b', title: 'Bravo' }] });
  });
});

describe('AlertEngine fault isolation', () => {
  it('one failing evaluator does not kill the tick', async () => {
    const store = tempStore();
    const nowMs = 1000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    const healthy: AlertRule = priceRule('healthy', 100);
    const broken: AlertRule = {
      id: 'broken',
      createdAt: 0,
      enabled: true,
      cooldownMinutes: 0,
      symbol: 'NVDA.US',
      type: 'new_news',
    };
    await repository.save(broken);
    await repository.save(healthy);

    const registry = createCapabilityRegistry([
      failingCap('research.news'),
      fakeCap('market.quote', makeQuote(150)),
      fakeCap('market.status', openStatus()),
    ]);

    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry,
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick();
    expect(events.length).toBe(1);
    expect(events[0].ruleId).toBe('healthy');
  });
});

describe('AlertEngine market-hours awareness', () => {
  it('skips price rules while the relevant market is closed', async () => {
    const store = tempStore();
    const nowMs = 1000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    await repository.save(priceRule('r1', 100));

    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry: makeRegistry({
        'market.quote': makeQuote(150),
        'market.status': [{ market: 'US', status: 'Closed' }],
      }),
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick();
    expect(events.length).toBe(0);
  });

  it('evaluates anyway when market.status is unavailable', async () => {
    const store = tempStore();
    const nowMs = 1000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    await repository.save(priceRule('r1', 100));

    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry: makeRegistry({ 'market.quote': makeQuote(150) }), // no market.status
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick();
    expect(events.length).toBe(1);
  });
});

describe('AlertEngine rating change across ticks', () => {
  it('detects a simulated rating change across two ticks', async () => {
    const store = tempStore();
    const nowMs = 1000;
    const clock = () => nowMs;
    const repository = new AlertRuleRepository(store, clock);
    const ratingRule: AlertRule = {
      id: 'rating-1',
      createdAt: 0,
      enabled: true,
      cooldownMinutes: 0,
      symbol: 'NVDA.US',
      type: 'rating_change',
    };
    await repository.save(ratingRule);

    let ratings = { recommend: 'strong_buy', target: 302 };
    const registry = makeRegistry({ 'company.ratings': () => ratings });
    const events: AlertTriggerEvent[] = [];
    const engine = new AlertEngine({
      registry,
      repository,
      eventLog: new AlertEventLog(store),
      now: clock,
      onTrigger: (event) => events.push(event),
    });

    await engine.tick(); // baseline recorded, no trigger
    expect(events.length).toBe(0);

    ratings = { recommend: 'hold', target: 280 };
    await engine.tick(); // change detected
    expect(events.length).toBe(1);
    expect(events[0].payload).toEqual({ previous: 'strong_buy@302', current: 'hold@280' });
  });
});

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlertRule } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { AlertRuleRepository, migrateAlerts } from './rules-repository.ts';

function tempStore(): JsonFileStore {
  return new JsonFileStore(mkdtempSync(join(tmpdir(), 'folio-alerts-repo-')));
}

describe('migrateAlerts', () => {
  it('maps all four V1 types and drops unknown types', () => {
    const now = () => 5_000;
    const old = [
      { id: 'a1', symbol: 'AAPL.US', type: 'price_above', value: 150, enabled: true, createdAt: 1000, triggered: false },
      { id: 'a2', symbol: 'NVDA.US', type: 'price_below', value: 80, enabled: false, createdAt: 2000, triggered: true, triggeredAt: 2500 },
      { symbol: 'TSLA.US', type: 'news', value: 0, enabled: true },
      { id: 'a4', symbol: 'MSFT.US', type: 'rating_change', value: 0, enabled: true, createdAt: 4000 },
      { id: 'a5', symbol: 'X.US', type: 'unknown_type', value: 1 },
    ];

    const { rules, migrated } = migrateAlerts(old, now);

    expect(migrated).toBe(true);
    expect(rules.length).toBe(4);

    const above = rules.find((r) => r.id === 'a1')!;
    expect(above.type).toBe('price_above');
    expect((above as Extract<AlertRule, { type: 'price_above' }>).targetPrice).toBe(150);
    expect(above.cooldownMinutes).toBe(30);

    const below = rules.find((r) => r.id === 'a2')!;
    expect(below.type).toBe('price_below');
    expect(below.lastTriggeredAt).toBe(2500);
    expect(below.enabled).toBe(false);

    const news = rules.find((r) => r.type === 'new_news')!;
    expect(news.id).toBeTruthy(); // synthesized id
    expect(news.createdAt).toBe(5_000); // synthesized createdAt
    expect(news.cooldownMinutes).toBe(30);

    const rating = rules.find((r) => r.id === 'a4')!;
    expect(rating.type).toBe('rating_change');
    expect('targetPrice' in rating).toBe(false);
  });

  it('treats a non-array (corrupt) payload as empty', () => {
    const result = migrateAlerts({ not: 'an array' }, () => 5_000);
    expect(result.rules).toEqual([]);
    expect(result.migrated).toBe(true);
  });

  it('leaves a clean V2 payload unchanged (no rewrite)', () => {
    const v2: AlertRule[] = [
      { id: 'r1', createdAt: 0, enabled: true, cooldownMinutes: 30, symbol: 'NVDA.US', type: 'price_above', targetPrice: 100 },
    ];
    const result = migrateAlerts(v2, () => 5_000);
    expect(result.migrated).toBe(false);
    expect(result.rules).toEqual(v2);
  });
});

describe('AlertRuleRepository migration on load', () => {
  it('migrates a V1 file on list() and writes the new schema back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-alerts-migrate-'));
    writeFileSync(
      join(dir, 'alerts.json'),
      JSON.stringify([
        { id: 'old1', symbol: 'AAPL.US', type: 'price_above', value: 200, enabled: true, createdAt: 111, triggered: false },
        { id: 'old2', symbol: 'NVDA.US', type: 'news', value: 0, enabled: true, createdAt: 222 },
      ])
    );
    const repository = new AlertRuleRepository(new JsonFileStore(dir), () => 9_999);

    const rules = await repository.list();
    expect(rules.length).toBe(2);
    expect(rules[0].type).toBe('price_above');
    expect((rules[0] as Extract<AlertRule, { type: 'price_above' }>).targetPrice).toBe(200);
    expect(rules[1].type).toBe('new_news');
    expect(rules.every((r) => typeof r.cooldownMinutes === 'number')).toBe(true);
  });

  it('treats a corrupt file as empty and never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-alerts-corrupt-'));
    writeFileSync(join(dir, 'alerts.json'), '{ definitely not json');
    const repository = new AlertRuleRepository(new JsonFileStore(dir));
    await expect(repository.list()).resolves.toEqual([]);
  });
});

describe('AlertRuleRepository persistence', () => {
  it('rules and evaluation cursors survive a restart', async () => {
    const store = tempStore();
    const repo1 = new AlertRuleRepository(store, () => 1_000);
    const rule: AlertRule = {
      id: 'r1',
      createdAt: 10,
      enabled: true,
      cooldownMinutes: 30,
      symbol: 'NVDA.US',
      type: 'price_above',
      targetPrice: 100,
    };
    await repo1.save(rule);
    await repo1.patchRule('r1', { lastCheckedAt: 2_000, lastTriggeredAt: 3_000 });

    const repo2 = new AlertRuleRepository(store, () => 5_000);
    const rules = await repo2.list();
    expect(rules.length).toBe(1);
    expect(rules[0].id).toBe('r1');
    expect(rules[0].lastCheckedAt).toBe(2_000);
    expect(rules[0].lastTriggeredAt).toBe(3_000);
  });

  it('rule snapshots persist in the separate snapshots file', async () => {
    const store = tempStore();
    const repo1 = new AlertRuleRepository(store);
    await repo1.patchRuleSnapshot('r1', { ratingSummary: 'buy@300' });

    const repo2 = new AlertRuleRepository(store);
    const snapshot = await repo2.getRuleSnapshot('r1');
    expect(snapshot.ratingSummary).toBe('buy@300');
  });

  it('remove deletes a rule', async () => {
    const store = tempStore();
    const repo = new AlertRuleRepository(store);
    const rule: AlertRule = {
      id: 'r1',
      createdAt: 10,
      enabled: true,
      cooldownMinutes: 30,
      symbol: 'NVDA.US',
      type: 'price_above',
      targetPrice: 100,
    };
    await repo.save(rule);
    await repo.remove('r1');
    expect(await repo.list()).toEqual([]);
  });
});

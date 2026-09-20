import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlertRule, Holding, PortfolioSnapshot } from '@finagent/core';
import { evaluateRule } from './evaluators.ts';
import { makeRegistry } from './testing.ts';
import { AlertEngine } from './engine.ts';
import { AlertEventLog } from './events.ts';
import { AlertRuleRepository } from './rules-repository.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';

const rule: AlertRule = { id: 'currency-weight', type: 'position_weight', symbol: '0700.HK', maxWeight: 0.3, enabled: true, cooldownMinutes: 0, createdAt: 0 };
function snapshot(holding: Partial<Holding>, baseCurrency: string | undefined = 'USD'): PortfolioSnapshot {
  return { baseCurrency, totalAssets: 1000, accounts: [], holdings: [{ symbol: '0700.HK', name: 'Tencent', currency: 'HKD', marketValue: 400, ...holding }], fetchedAt: 0 };
}
async function evaluate(data: PortfolioSnapshot) {
  return evaluateRule(rule, makeRegistry({ 'portfolio.summary': data }));
}

describe('position weight currency boundary', () => {
  it('does not compare a foreign-currency market value with base-currency assets', async () => {
    expect(await evaluate(snapshot({}))).toBeNull();
  });
  it('requires known matching currencies for the local market value fallback', async () => {
    expect(await evaluate(snapshot({ currency: undefined }))).toBeNull();
    const data = snapshot({ currency: 'USD' });
    delete data.baseCurrency;
    expect(await evaluate(data)).toBeNull();
  });
  it('retains same-currency fallback after normalizing currency codes', async () => {
    expect((await evaluate(snapshot({ currency: ' usd ' })))?.payload?.weight).toBeCloseTo(0.4);
  });
  it('prefers base-currency values and preserves a genuine zero', async () => {
    expect(await evaluate(snapshot({ marketValueBase: 50 }))).toBeNull();
    expect(await evaluate(snapshot({ marketValueBase: 0 }))).toBeNull();
    expect((await evaluate(snapshot({ marketValueBase: 400 })))?.payload?.weight).toBeCloseTo(0.4);
  });
  it('does not persist or notify a false alert, then recovers when conversion is available', async () => {
    const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'folio-weight-currency-')));
    const repository = new AlertRuleRepository(store);
    const events = new AlertEventLog(store);
    await repository.save(rule);
    let data = snapshot({});
    let notifications = 0;
    const engine = new AlertEngine({ repository, eventLog: events, registry: makeRegistry({ 'portfolio.summary': () => data }), onTrigger: () => { notifications += 1; } });
    await engine.tick();
    expect(notifications).toBe(0);
    expect(await events.list()).toEqual([]);
    data = snapshot({ marketValueBase: 400 });
    await engine.tick();
    expect(notifications).toBe(1);
    const persisted = await new AlertEventLog(store).list();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].payload?.weight).toBeCloseTo(0.4);
  });
});
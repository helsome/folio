import { expect, test } from 'bun:test';
import { evaluateRule } from './evaluators.ts';
import { base, makeRegistry, makeSnapshotContext } from './testing.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertEngine } from './engine.ts';
import { AlertRuleRepository } from './rules-repository.ts';
import { AlertEventLog } from './events.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';

async function observe(current: number | undefined) {
  let totalAssets: number | undefined = 1000;
  const registry = makeRegistry({
    'portfolio.summary': () => ({ totalAssets, baseCurrency: 'USD', holdings: [], accounts: [], fetchedAt: 0 }),
  });
  const rule = { ...base(), type: 'portfolio_drawdown' as const, threshold: 0.1 };
  const context = { ...makeSnapshotContext(), now: () => 1700000000000 };
  expect(await evaluateRule(rule, registry, context)).toBeNull();
  expect((await context.getRuleSnapshot(rule.id)).peakValue).toBe(1000);
  totalAssets = current;
  return evaluateRule(rule, registry, context);
}

test('positive remaining assets trigger 90% drawdown', async () => {
  expect((await observe(100))?.payload?.drawdown).toBe(0.9);
});

test('explicit zero assets trigger 100% drawdown after a positive peak', async () => {
  expect((await observe(0))?.payload?.drawdown).toBe(1);
});

test('missing assets remain unknown rather than zero', async () => {
  expect(await observe(undefined)).toBeNull();
});

test.each([NaN, Infinity, -Infinity, -1])('ignores invalid or negative assets: %s', async (value) => {
  expect(await observe(value)).toBeNull();
});

test('initial zero does not establish a zero peak or block a later positive peak', async () => {
  let totalAssets = 0;
  const registry = makeRegistry({ 'portfolio.summary': () => ({ totalAssets, baseCurrency: 'USD' }) });
  const rule = { ...base(), type: 'portfolio_drawdown' as const, threshold: 0.1 };
  const context = makeSnapshotContext();
  expect(await evaluateRule(rule, registry, context)).toBeNull();
  expect((await context.getRuleSnapshot(rule.id)).peakValue).toBeUndefined();
  totalAssets = 1000;
  expect(await evaluateRule(rule, registry, context)).toBeNull();
  expect((await context.getRuleSnapshot(rule.id)).peakValue).toBe(1000);
  totalAssets = 0;
  expect((await evaluateRule(rule, registry, context))?.payload?.drawdown).toBe(1);
});

test('zero assets notify and persist a full drawdown after restarting the engine', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folio-drawdown-zero-'));
  try {
    const store = new JsonFileStore(dir);
    const repository = new AlertRuleRepository(store);
    const rule = { ...base(), type: 'portfolio_drawdown' as const, threshold: 0.1 };
    await repository.save(rule);
    let totalAssets = 1000;
    const registry = makeRegistry({ 'portfolio.summary': () => ({ totalAssets, baseCurrency: 'USD' }) });
    await new AlertEngine({ repository, eventLog: new AlertEventLog(store), registry }).tick();
    expect((await repository.getRuleSnapshot(rule.id)).peakValue).toBe(1000);
    totalAssets = 0;
    let notifications = 0;
    const restartedStore = new JsonFileStore(dir);
    await new AlertEngine({
      repository: new AlertRuleRepository(restartedStore),
      eventLog: new AlertEventLog(restartedStore), registry,
      onTrigger: () => { notifications += 1; },
    }).tick();
    expect(notifications).toBe(1);
    const events = await new AlertEventLog(new JsonFileStore(dir)).list();
    expect(events).toHaveLength(1);
    expect(events[0].payload?.drawdown).toBe(1);
    expect(events[0].payload?.peak).toBe(1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

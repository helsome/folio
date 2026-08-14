import { beforeEach, describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { AlertRule, AlertTriggerEvent } from '@finagent/core';
import type { FinagentClient } from '../client';
import { loadAlertEvents, loadAlertRules, saveAlertRules } from '../client/alerts';
import {
  addAlertAtom,
  alertStateAtom,
  buildAlertRule,
  loadAlertsAtom,
  removeAlertAtom,
  ruleSummary,
  toggleAlertAtom,
} from './alertAtoms';

let savedRules: AlertRule[] = [];
const sampleEvents: AlertTriggerEvent[] = [
  { id: 'e1', ruleId: 'r1', ruleType: 'price_above', symbol: 'NVDA.US', triggeredAt: 1234, title: 't', message: 'm' },
];

function makeClient(rules: AlertRule[] = [], events: AlertTriggerEvent[] = []): FinagentClient {
  savedRules = [...rules];
  const client = {
    alerts: {
      loadRules: async () => ({ ok: true as const, data: rules }),
      listEvents: async () => ({ ok: true as const, data: events }),
      saveRules: async (next: AlertRule[]) => {
        savedRules = [...next];
        return { ok: true as const, data: undefined };
      },
    },
  };
  return client as unknown as FinagentClient;
}

function makeRule(id: string, type: AlertRule['type']): AlertRule {
  return buildAlertRule({ type, symbol: 'NVDA.US', targetPrice: 100 }, id, 0);
}

describe('buildAlertRule', () => {
  it('builds a price rule with targetPrice and default cooldown', () => {
    const rule = buildAlertRule({ type: 'price_above', symbol: 'NVDA.US', targetPrice: 150 }, 'r1', 5);
    expect(rule).toEqual({
      id: 'r1',
      createdAt: 5,
      enabled: true,
      cooldownMinutes: 30,
      symbol: 'NVDA.US',
      type: 'price_above',
      targetPrice: 150,
    });
  });

  it('defaults earnings horizonDays to 14', () => {
    const rule = buildAlertRule({ type: 'earnings', symbol: 'NVDA.US' }, 'r2', 5);
    expect(rule).toMatchObject({ type: 'earnings', horizonDays: 14 });
  });

  it('carries min/max weights for position_weight', () => {
    const rule = buildAlertRule(
      { type: 'position_weight', symbol: 'NVDA.US', minWeight: 0.1, maxWeight: 0.3 },
      'r3',
      5
    );
    expect(rule).toMatchObject({ type: 'position_weight', minWeight: 0.1, maxWeight: 0.3 });
  });

  it('builds a portfolio_drawdown rule with no symbol', () => {
    const rule = buildAlertRule({ type: 'portfolio_drawdown', threshold: 0.1 }, 'r4', 5);
    expect(rule).toMatchObject({ type: 'portfolio_drawdown', threshold: 0.1 });
    expect('symbol' in rule).toBe(false);
  });
});

describe('ruleSummary', () => {
  it('renders a per-type summary', () => {
    expect(ruleSummary(makeRule('a', 'price_above'))).toBe('Above $100.00');
    expect(ruleSummary(makeRule('b', 'price_below'))).toBe('Below $100.00');
    expect(ruleSummary(buildAlertRule({ type: 'new_news', symbol: 'NVDA.US' }, 'c', 0))).toBe('New headlines');
    expect(
      ruleSummary(buildAlertRule({ type: 'position_weight', symbol: 'NVDA.US', minWeight: 0.1, maxWeight: 0.3 }, 'd', 0))
    ).toBe('Weight outside [10%, 30%]');
    expect(ruleSummary(buildAlertRule({ type: 'portfolio_drawdown', threshold: 0.1 }, 'e', 0))).toBe(
      'Drawdown > 10%'
    );
  });
});

describe('alert atoms', () => {
  beforeEach(() => {
    savedRules = [];
  });

  it('loads rules and events into state', async () => {
    const store = createStore();
    const rules = [makeRule('r1', 'price_above')];
    await store.set(loadAlertsAtom, makeClient(rules, sampleEvents));

    expect(store.get(alertStateAtom).rules).toHaveLength(1);
    expect(store.get(alertStateAtom).events).toHaveLength(1);
    expect(store.get(alertStateAtom).loading).toBe(false);
  });

  it('adds a rule and persists the full list', async () => {
    const store = createStore();
    const client = makeClient();
    await store.set(addAlertAtom, { client, rule: makeRule('r1', 'price_above') });

    expect(store.get(alertStateAtom).rules).toHaveLength(1);
    expect(savedRules).toHaveLength(1);
  });

  it('removes a rule and persists the pruned list', async () => {
    const store = createStore();
    const client = makeClient([makeRule('r1', 'price_above'), makeRule('r2', 'price_below')]);
    await store.set(loadAlertsAtom, client);
    await store.set(removeAlertAtom, { client, ruleId: 'r1' });

    expect(store.get(alertStateAtom).rules.map((r) => r.id)).toEqual(['r2']);
    expect(savedRules.map((r) => r.id)).toEqual(['r2']);
  });

  it('toggles enabled and persists', async () => {
    const store = createStore();
    const client = makeClient([makeRule('r1', 'price_above')]);
    await store.set(loadAlertsAtom, client);
    await store.set(toggleAlertAtom, { client, ruleId: 'r1' });

    expect(store.get(alertStateAtom).rules[0].enabled).toBe(false);
    expect(savedRules[0].enabled).toBe(false);
  });
});

describe('defensive client loader', () => {
  it('degrades to empty when the alerts channel is missing', async () => {
    const client = {} as unknown as FinagentClient;
    expect(await loadAlertRules(client)).toEqual([]);
    expect(await loadAlertEvents(client)).toEqual([]);
    expect(await saveAlertRules(client, [makeRule('r1', 'price_above')])).toBe(false);
  });
});

import { randomUUID } from 'node:crypto';
import type { AlertRule, AlertRuleType } from '@finagent/core';
import { ALERT_RULE_TYPES } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

/**
 * Alert rules persistence + v1→v2 migration.
 *
 * Rules live at `<userData>/alerts.json` (same file, new discriminated-union
 * schema). On load, the flat V1 `Alert { type; value }` shapes are migrated
 * to the v2 union; a corrupt or unreadable file degrades to an empty list.
 *
 * Per-rule evaluation state that must not pollute the `AlertRule` union
 * (rating snapshot, drawdown peak) is kept in a separate file
 * `<userData>/alerts-snapshots.json` keyed by rule id.
 */

const RULES_FILE = 'alerts.json';
const SNAPSHOTS_FILE = 'alerts-snapshots.json';
const DEFAULT_COOLDOWN_MINUTES = 30;

const NEW_TYPES: ReadonlySet<string> = new Set<string>(ALERT_RULE_TYPES);

/** Per-rule evaluation state stored outside the rule union. */
export interface AlertRuleSnapshot {
  /** Canonical rating summary for `rating_change` rules. */
  ratingSummary?: string;
  /** Highest portfolio value seen by a `portfolio_drawdown` rule. */
  peakValue?: number;
}

export interface AlertRulePatch {
  lastCheckedAt?: number;
  lastTriggeredAt?: number;
}

export interface MigratedRules {
  rules: AlertRule[];
  /** True when the on-disk representation changed and should be written back. */
  migrated: boolean;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function warn(message: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(`[alerts] ${message}`);
  } else {
    console.warn(`[alerts] ${message}:`, detail);
  }
}

interface MigratedEntry {
  rule: AlertRule;
  changed: boolean;
}

function migrateEntry(entry: unknown, now: () => number): MigratedEntry | null {
  if (!entry || typeof entry !== 'object') {
    warn('dropping non-object alert entry', entry);
    return null;
  }
  const e = entry as Record<string, unknown>;
  const rawType = e.type;
  const type = rawType === 'news' ? 'new_news' : rawType;

  if (typeof type !== 'string' || !NEW_TYPES.has(type)) {
    warn(`dropping alert with unknown type "${String(rawType)}"`);
    return null;
  }

  // V1 rules carry no `cooldownMinutes`; a rule that has it is already v2.
  const isNew = typeof e.cooldownMinutes === 'number';
  let changed = !isNew || rawType === 'news';

  const id = typeof e.id === 'string' && e.id.length > 0 ? e.id : null;
  if (id === null) changed = true;

  const createdAt = toOptionalNumber(e.createdAt);
  if (createdAt === undefined) changed = true;

  const lastCheckedAt = toOptionalNumber(e.lastCheckedAt);
  const lastTriggeredAt =
    toOptionalNumber(e.lastTriggeredAt) ?? toOptionalNumber(e.triggeredAt);
  if (toOptionalNumber(e.lastTriggeredAt) === undefined && toOptionalNumber(e.triggeredAt) !== undefined) {
    changed = true;
  }

  const symbol = typeof e.symbol === 'string' ? e.symbol.trim() : '';

  const base = {
    id: id ?? randomUUID(),
    createdAt: createdAt ?? now(),
    enabled: typeof e.enabled === 'boolean' ? e.enabled : true,
    cooldownMinutes: typeof e.cooldownMinutes === 'number' ? e.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES,
    ...(lastCheckedAt !== undefined ? { lastCheckedAt } : {}),
    ...(lastTriggeredAt !== undefined ? { lastTriggeredAt } : {}),
  };

  switch (type) {
    case 'price_above':
    case 'price_below': {
      const targetPrice = toOptionalNumber(isNew ? e.targetPrice : e.value);
      if (symbol === '' || targetPrice === undefined) {
        warn(`dropping ${type} alert without symbol or target price`);
        return null;
      }
      return { rule: { ...base, symbol, type, targetPrice }, changed };
    }
    case 'new_news':
    case 'rating_change': {
      if (symbol === '') {
        warn(`dropping ${type} alert without symbol`);
        return null;
      }
      return { rule: { ...base, symbol, type }, changed };
    }
    case 'earnings': {
      if (symbol === '') {
        warn('dropping earnings alert without symbol');
        return null;
      }
      const horizonDays = toOptionalNumber(e.horizonDays);
      if (horizonDays === undefined) {
        warn('dropping earnings alert without horizonDays');
        return null;
      }
      return { rule: { ...base, symbol, type, horizonDays }, changed };
    }
    case 'dividend': {
      if (symbol === '') {
        warn('dropping dividend alert without symbol');
        return null;
      }
      return { rule: { ...base, symbol, type }, changed };
    }
    case 'position_weight': {
      if (symbol === '') {
        warn('dropping position_weight alert without symbol');
        return null;
      }
      const minWeight = toOptionalNumber(e.minWeight);
      const maxWeight = toOptionalNumber(e.maxWeight);
      return {
        rule: {
          ...base,
          symbol,
          type,
          ...(minWeight !== undefined ? { minWeight } : {}),
          ...(maxWeight !== undefined ? { maxWeight } : {}),
        },
        changed,
      };
    }
    case 'portfolio_drawdown': {
      const threshold = toOptionalNumber(e.threshold);
      if (threshold === undefined) {
        warn('dropping portfolio_drawdown alert without threshold');
        return null;
      }
      return { rule: { ...base, type, threshold }, changed };
    }
    default:
      return null;
  }
}

/**
 * Pure migration: raw `alerts.json` content → v2 `AlertRule[]`. Old shapes are
 * mapped (`news`→`new_news`, `value`→`targetPrice`, `triggeredAt`→
 * `lastTriggeredAt`); missing ids/createdAt/cooldownMinutes are synthesized;
 * unknown types are dropped with a warning. A non-array (corrupt) payload
 * yields an empty list.
 */
export function migrateAlerts(raw: unknown, now: () => number = Date.now): MigratedRules {
  if (!Array.isArray(raw)) {
    return { rules: [], migrated: true };
  }
  const rules: AlertRule[] = [];
  let migrated = false;
  for (const entry of raw) {
    const result = migrateEntry(entry, now);
    if (result === null) {
      migrated = true;
      continue;
    }
    if (result.changed) migrated = true;
    rules.push(result.rule);
  }
  return { rules, migrated };
}

export class AlertRuleRepository {
  private readonly store: JsonFileStore;
  private readonly now: () => number;

  constructor(store: JsonFileStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  private async readRaw(): Promise<unknown> {
    try {
      return await this.store.read<unknown>(RULES_FILE, []);
    } catch {
      // Corrupt / unreadable file — treat as empty (spec: never crash).
      return [];
    }
  }

  private async readRules(): Promise<AlertRule[]> {
    return migrateAlerts(await this.readRaw(), this.now).rules;
  }

  /** List rules; migrates a V1 file in place on first read. */
  async list(): Promise<AlertRule[]> {
    const raw = await this.readRaw();
    const { rules, migrated } = migrateAlerts(raw, this.now);
    if (migrated && Array.isArray(raw)) {
      await this.store.write(RULES_FILE, rules);
    }
    return rules;
  }

  async get(id: string): Promise<AlertRule | null> {
    const rules = await this.readRules();
    return rules.find((rule) => rule.id === id) ?? null;
  }

  /** Insert or replace a rule. */
  async save(rule: AlertRule): Promise<AlertRule> {
    const rules = await this.readRules();
    const index = rules.findIndex((existing) => existing.id === rule.id);
    if (index >= 0) {
      rules[index] = rule;
    } else {
      rules.push(rule);
    }
    await this.store.write(RULES_FILE, rules);
    return rule;
  }

  async remove(id: string): Promise<void> {
    const rules = await this.readRules();
    await this.store.write(
      RULES_FILE,
      rules.filter((rule) => rule.id !== id)
    );
  }

  /** Patch evaluation cursors without rewriting the rule's own shape. */
  async patchRule(id: string, patch: AlertRulePatch): Promise<AlertRule | null> {
    const rules = await this.readRules();
    const index = rules.findIndex((rule) => rule.id === id);
    if (index < 0) return null;
    const updated = { ...rules[index], ...patch } as AlertRule;
    rules[index] = updated;
    await this.store.write(RULES_FILE, rules);
    return updated;
  }

  private async readSnapshots(): Promise<Record<string, AlertRuleSnapshot>> {
    try {
      return await this.store.read<Record<string, AlertRuleSnapshot>>(SNAPSHOTS_FILE, {});
    } catch {
      return {};
    }
  }

  async getRuleSnapshot(ruleId: string): Promise<AlertRuleSnapshot> {
    const snapshots = await this.readSnapshots();
    return snapshots[ruleId] ?? {};
  }

  async patchRuleSnapshot(ruleId: string, patch: Partial<AlertRuleSnapshot>): Promise<AlertRuleSnapshot> {
    const snapshots = await this.readSnapshots();
    const next = { ...(snapshots[ruleId] ?? {}), ...patch };
    snapshots[ruleId] = next;
    await this.store.write(SNAPSHOTS_FILE, snapshots);
    return next;
  }
}

export type { AlertRule, AlertRuleType };

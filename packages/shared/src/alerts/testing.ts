import { Type } from '@sinclair/typebox';
import type { AlertRule, AlertRuleBase, CapabilityRegistry, FinanceCapability } from '@finagent/core';
import { defineCapability } from '../capabilities/define.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import type { AlertEvaluatorContext, AlertRuleSnapshot } from './evaluators.ts';

/** Build a fake capability returning static (or lazily-computed) data. */
export function fakeCap(id: string, data: unknown | (() => unknown)): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName: id,
    inputSchema: Type.Object({}),
    execute: async () => ({
      data: typeof data === 'function' ? (data as () => unknown)() : data,
      provenance: { provider: 'test', fetchedAt: 0, stale: false },
    }),
  });
}

/** A capability whose execution throws (simulates a broken fetcher). */
export function failingCap(id: string): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'failing test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName: id,
    inputSchema: Type.Object({}),
    execute: async () => {
      throw new Error(`simulated failure for ${id}`);
    },
  });
}

export function makeRegistry(entries: Record<string, unknown | (() => unknown)>): CapabilityRegistry {
  return createCapabilityRegistry(Object.entries(entries).map(([id, data]) => fakeCap(id, data)));
}
let idCounter = 0;
export function rid(): string {
  idCounter += 1;
  return `rule-${idCounter}`;
}

export function base(extra: Partial<AlertRuleBase> = {}): AlertRuleBase {
  return {
    id: rid(),
    createdAt: 0,
    enabled: true,
    cooldownMinutes: 0,
    ...extra,
  };
}

/** In-memory snapshot store for evaluator context injection. */
export function makeSnapshotContext(
  initial: Record<string, AlertRuleSnapshot> = {}
): Pick<AlertEvaluatorContext, 'getRuleSnapshot' | 'patchRuleSnapshot'> {
  const store = new Map<string, AlertRuleSnapshot>(Object.entries(initial));
  return {
    getRuleSnapshot: async (ruleId) => store.get(ruleId) ?? {},
    patchRuleSnapshot: async (ruleId, patch) => {
      const next = { ...(store.get(ruleId) ?? {}), ...patch };
      store.set(ruleId, next);
      return next;
    },
  };
}

export type { AlertRule };

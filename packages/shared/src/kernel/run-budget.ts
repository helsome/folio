/**
 * Run budget contract for Agent / Deep Research runs.
 *
 * A run's ceiling is a contract, not a workflow-local constant: defaults come
 * from the application, a run may override them, and a system-level ceiling
 * always wins. Exhaustion surfaces as a machine-readable `StopReason` plus the
 * key that ran out, so traces, UI and evaluation can explain why a run stopped
 * instead of reporting it as an ordinary success.
 */

import type { StopReason } from '@finagent/core';

/** Every dimension a run budget can constrain. */
export type BudgetKey =
  | 'wallClockMs'
  | 'modelCalls'
  | 'toolCalls'
  | 'searchIterations'
  | 'inputTokens'
  | 'outputTokens'
  | 'costUsd';

/**
 * Budget keys in check order: wall-clock first, then the counters the runtime
 * observes directly, then provider-reported usage. `checkBudget` reports the
 * first exhausted key in this order, so the same state always yields the same
 * reason.
 */
export const BUDGET_KEYS: readonly BudgetKey[] = [
  'wallClockMs',
  'modelCalls',
  'toolCalls',
  'searchIterations',
  'inputTokens',
  'outputTokens',
  'costUsd',
];

/** Upper bounds for a run; an absent key is unlimited. */
export type RunBudgetLimits = Partial<Record<BudgetKey, number>>;

/**
 * Consumption accumulated so far; every key is always present.
 *
 * `wallClockMs` is absolute elapsed time since the run started, not a delta, so
 * a caller recomputes it from the run's start timestamp at each check; every
 * other key accumulates through {@link addUsage}.
 */
export type RunBudgetUsage = Record<BudgetKey, number>;

/** The key that ran out, with the numbers needed to explain it. */
export interface BudgetExhaustion {
  key: BudgetKey;
  limit: number;
  used: number;
}

/**
 * Why a run stopped. Owned by the core protocol because the UI, telemetry and
 * evaluation read it off the persisted run record; re-exported here so callers
 * that only work with budgets keep importing it from one place.
 */
export type { StopReason };

/** A run outcome paired with the detail behind a non-success reason. */
export interface RunStop {
  stopReason: StopReason;
  detail?: Record<string, unknown>;
}

/** Resolution result: the limits a run must obey, and any override the ceiling cut down. */
export interface ResolvedBudget {
  limits: RunBudgetLimits;
  clamped: BudgetKey[];
}

/** How a caller asks for effective limits. */
export interface ResolveBudgetInput {
  defaults?: RunBudgetLimits;
  overrides?: RunBudgetLimits;
  ceiling?: RunBudgetLimits;
}

/** Zeroed usage; the starting point of every run. */
export function createUsage(): RunBudgetUsage {
  return {
    wallClockMs: 0,
    modelCalls: 0,
    toolCalls: 0,
    searchIterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

/**
 * Reject a limit the runtime cannot enforce. Fail-loud by design: a silently
 * ignored budget is worse than a refused run, because it looks enforced.
 * @param key - the budget dimension being validated.
 * @param value - the requested limit.
 */
function assertLimit(key: BudgetKey, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `run-budget: ${key} must be a positive finite number, received ${String(value)}`,
    );
  }
}

/**
 * Resolve the limits a run must obey: defaults, then per-run overrides, always
 * clamped by the system ceiling.
 * @param input - defaults, overrides and the ceiling.
 * @returns the effective limits and the keys the ceiling cut down.
 */
export function resolveBudget(input: ResolveBudgetInput): ResolvedBudget {
  const limits: RunBudgetLimits = {};
  const clamped: BudgetKey[] = [];

  for (const key of BUDGET_KEYS) {
    const ceiling = input.ceiling?.[key];
    const override = input.overrides?.[key];
    const fallback = input.defaults?.[key];
    if (ceiling !== undefined) assertLimit(key, ceiling);
    if (override !== undefined) assertLimit(key, override);
    if (fallback !== undefined) assertLimit(key, fallback);

    const requested = override ?? fallback;
    if (requested === undefined) {
      if (ceiling !== undefined) limits[key] = ceiling;
      continue;
    }

    const effective = ceiling === undefined ? requested : Math.min(requested, ceiling);
    if (effective !== requested) clamped.push(key);
    limits[key] = effective;
  }

  return { limits, clamped };
}

/**
 * Accumulate one step's consumption without mutating the previous usage, so a
 * run can report the usage of an abandoned branch of work.
 * @param usage - usage accumulated so far.
 * @param delta - what this step consumed.
 * @returns a new usage record.
 */
export function addUsage(usage: RunBudgetUsage, delta: Partial<RunBudgetUsage>): RunBudgetUsage {
  const next: RunBudgetUsage = { ...usage };

  for (const key of BUDGET_KEYS) {
    const value = delta[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `run-budget: ${key} delta must be a non-negative finite number, received ${String(value)}`,
      );
    }
    next[key] = usage[key] + value;
  }

  return next;
}

/**
 * Whether a run has spent its budget.
 * @param limits - effective limits; absent keys are unlimited.
 * @param usage - consumption so far.
 * @returns the first exhausted key in {@link BUDGET_KEYS} order, else undefined.
 */
export function checkBudget(
  limits: RunBudgetLimits,
  usage: RunBudgetUsage,
): BudgetExhaustion | undefined {
  for (const key of BUDGET_KEYS) {
    const limit = limits[key];
    if (limit === undefined) continue;
    if (usage[key] >= limit) return { key, limit, used: usage[key] };
  }

  return undefined;
}

/**
 * Turn an exhaustion into the run's stop reason, keeping the numbers in the
 * detail so a summary can say which budget ran out and by how much.
 * @param exhaustion - the exhausted budget key.
 * @returns a `budget_exhausted` stop with its detail.
 */
export function budgetStop(exhaustion: BudgetExhaustion): RunStop {
  return {
    stopReason: 'budget_exhausted',
    detail: { key: exhaustion.key, limit: exhaustion.limit, used: exhaustion.used },
  };
}

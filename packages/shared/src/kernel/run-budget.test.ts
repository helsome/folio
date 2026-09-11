import { describe, expect, it } from 'bun:test';
import {
  addUsage,
  budgetStop,
  checkBudget,
  createUsage,
  resolveBudget,
  type RunBudgetUsage,
} from './run-budget.ts';

describe('createUsage', () => {
  it('starts every budget key at zero', () => {
    expect(createUsage()).toEqual({
      wallClockMs: 0,
      modelCalls: 0,
      toolCalls: 0,
      searchIterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });
});

describe('resolveBudget', () => {
  it('applies overrides on top of defaults', () => {
    const { limits, clamped } = resolveBudget({
      defaults: { modelCalls: 20, toolCalls: 30 },
      overrides: { modelCalls: 50 },
    });

    expect(limits).toEqual({ modelCalls: 50, toolCalls: 30 });
    expect(clamped).toEqual([]);
  });

  it('lets a run tighten a limit below the default', () => {
    const { limits } = resolveBudget({ defaults: { toolCalls: 30 }, overrides: { toolCalls: 5 } });

    expect(limits.toolCalls).toBe(5);
  });

  it('clamps an override to the system ceiling and reports the clamped key', () => {
    const { limits, clamped } = resolveBudget({
      defaults: { modelCalls: 20 },
      overrides: { modelCalls: 1000, costUsd: 999 },
      ceiling: { modelCalls: 100, costUsd: 5 },
    });

    expect(limits).toEqual({ modelCalls: 100, costUsd: 5 });
    expect(clamped).toEqual(['modelCalls', 'costUsd']);
  });

  it('leaves a limit unlimited when no default, override or ceiling sets it', () => {
    const { limits } = resolveBudget({ defaults: { modelCalls: 20 } });

    expect(limits.toolCalls).toBeUndefined();
    expect(limits.costUsd).toBeUndefined();
  });

  it('clamps a default that already exceeds the ceiling', () => {
    const { limits, clamped } = resolveBudget({ defaults: { modelCalls: 100 }, ceiling: { modelCalls: 10 } });

    expect(limits.modelCalls).toBe(10);
    expect(clamped).toEqual(['modelCalls']);
  });

  it('fails loudly on a non-positive or non-finite limit', () => {
    expect(() => resolveBudget({ overrides: { modelCalls: 0 } })).toThrow(/modelCalls/);
    expect(() => resolveBudget({ overrides: { toolCalls: -1 } })).toThrow(/toolCalls/);
    expect(() => resolveBudget({ overrides: { costUsd: Number.POSITIVE_INFINITY } })).toThrow(/costUsd/);
    expect(() => resolveBudget({ overrides: { wallClockMs: Number.NaN } })).toThrow(/wallClockMs/);
  });
});

describe('addUsage', () => {
  it('accumulates deltas without mutating the input usage', () => {
    const before = createUsage();
    const after = addUsage(before, { modelCalls: 2, costUsd: 0.5 });

    expect(after.modelCalls).toBe(2);
    expect(after.costUsd).toBe(0.5);
    expect(before.modelCalls).toBe(0);
    expect(before.costUsd).toBe(0);
  });

  it('fails loudly on a negative delta', () => {
    expect(() => addUsage(createUsage(), { toolCalls: -1 })).toThrow(/toolCalls/);
  });
});

describe('checkBudget', () => {
  const usage: RunBudgetUsage = { ...createUsage(), modelCalls: 5, toolCalls: 3 };

  it('reports the first exhausted key in a deterministic order', () => {
    const exhaustion = checkBudget({ toolCalls: 3, modelCalls: 5 }, usage);

    // wall-clock and the call counters are checked before token/cost keys, so the
    // model-call limit wins even though the tool-call limit is listed first above.
    expect(exhaustion).toEqual({ key: 'modelCalls', limit: 5, used: 5 });
  });

  it('treats a limit as exhausted once usage reaches it', () => {
    expect(checkBudget({ modelCalls: 6 }, usage)).toBeUndefined();
    expect(checkBudget({ modelCalls: 5 }, usage)).toEqual({ key: 'modelCalls', limit: 5, used: 5 });
  });

  it('ignores keys with no limit and usage that stays under budget', () => {
    expect(checkBudget({ costUsd: 10, toolCalls: 10 }, usage)).toBeUndefined();
  });
});

describe('budgetStop', () => {
  it('turns an exhaustion into a machine-readable stop reason with its detail', () => {
    const stop = budgetStop({ key: 'searchIterations', limit: 8, used: 8 });

    expect(stop.stopReason).toBe('budget_exhausted');
    expect(stop.detail).toEqual({ key: 'searchIterations', limit: 8, used: 8 });
  });
});

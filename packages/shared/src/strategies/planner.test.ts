import { describe, expect, it } from 'bun:test';
import {
  CapabilityExecutor,
  createCapabilityRegistry,
  createFullRegistry,
  validateInput,
} from '../capabilities/index.ts';
import {
  buildCapabilityInput,
  planForStrategy,
  RESEARCH_CAPABILITY_PLAN,
} from '../research/planner.ts';
import { fakeCap } from '../research/test-helpers.ts';
import { strategyCapabilityIds } from './planner.ts';
import { COMPREHENSIVE_CAPABILITY_IDS, RESEARCH_STRATEGIES } from './presets.ts';

describe('strategyCapabilityIds', () => {
  it('returns the caller basePlan when no strategy is given', () => {
    const base = ['company.profile', 'research.news'];
    expect(strategyCapabilityIds(undefined, base)).toEqual(base);
  });

  it('defaults the basePlan to the comprehensive capability list', () => {
    expect(strategyCapabilityIds(undefined)).toEqual([...COMPREHENSIVE_CAPABILITY_IDS]);
  });

  it('resolves each strategy to its declared capability list', () => {
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      expect(strategyCapabilityIds(strategy.id)).toEqual([...strategy.capabilityIds]);
    }
  });

  it('returns comprehensive in the canonical comprehensive order', () => {
    expect(strategyCapabilityIds('comprehensive')).toEqual([
      ...COMPREHENSIVE_CAPABILITY_IDS,
    ]);
  });
});

describe('planForStrategy', () => {
  it('keeps the legacy plan for strategy-less runs', () => {
    const registry = createCapabilityRegistry(
      RESEARCH_CAPABILITY_PLAN.map((id) => fakeCap(id))
    );
    const plan = planForStrategy(undefined, registry);
    expect(plan.map((p) => p.capabilityId)).toEqual([...RESEARCH_CAPABILITY_PLAN]);
    expect(plan.every((p) => p.available)).toBe(true);
  });

  it('marks absent capabilities as planned-but-unavailable', () => {
    const registry = createCapabilityRegistry([fakeCap('company.profile')]);
    const plan = planForStrategy('value', registry);
    expect(plan.map((p) => p.capabilityId)).toEqual([...RESEARCH_STRATEGIES.value.capabilityIds]);
    expect(plan.find((p) => p.capabilityId === 'company.profile')?.available).toBe(true);
    expect(plan.find((p) => p.capabilityId === 'company.valuation')?.available).toBe(false);
  });

  it('returns specs the executor can run end-to-end', async () => {
    const ids = RESEARCH_STRATEGIES.value.capabilityIds;
    const registry = createCapabilityRegistry(ids.map((id) => fakeCap(id)));
    const executor = new CapabilityExecutor({ now: () => 1_700_000_000_000 });

    const outcomes = await executor.runAll(
      planForStrategy('value', registry)
        .filter((p) => p.available)
        .map((p) => ({ cap: registry.get(p.capabilityId)!, input: { symbol: 'NVDA.US' } })),
      { concurrency: 4, timeoutMs: 2000 }
    );

    expect(outcomes).toHaveLength(ids.length);
    expect(outcomes.every((o) => o.record.status === 'success')).toBe(true);
  });

  it('builds inputs that validate against the real manifest schemas', () => {
    const registry = createFullRegistry();
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      for (const planned of planForStrategy(strategy.id, registry)) {
        if (!planned.available) continue;
        const cap = registry.get(planned.capabilityId);
        expect(cap).toBeDefined();
        // The runner's input builder must satisfy every planned schema, or a
        // real run would fail the capability at validation time.
        expect(() =>
          validateInput(cap!.inputSchema, buildCapabilityInput(planned.capabilityId, 'AAPL.US'))
        ).not.toThrow();
      }
    }
  });

  it('documents the structured input research.events needs', () => {
    expect(buildCapabilityInput('research.events', 'AAPL.US')).toEqual({
      eventType: 'financial',
      symbols: ['AAPL.US'],
    });
    expect(buildCapabilityInput('market.quote', 'AAPL.US')).toEqual({ symbol: 'AAPL.US' });
  });
});

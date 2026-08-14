import { describe, expect, it } from 'bun:test';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { fakeCap } from './test-helpers.ts';
import { planCapabilities, RESEARCH_CAPABILITY_PLAN } from './planner.ts';

describe('planCapabilities', () => {
  it('marks every capability available against a full registry', () => {
    const registry = createCapabilityRegistry(
      RESEARCH_CAPABILITY_PLAN.map((id) => fakeCap(id))
    );
    const plan = planCapabilities('NVDA.US', registry);
    expect(plan).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);
    expect(plan.every((p) => p.available)).toBe(true);
    expect(plan.map((p) => p.capabilityId)).toEqual([...RESEARCH_CAPABILITY_PLAN]);
  });

  it('keeps absent capabilities as planned-but-unavailable entries', () => {
    const registered = ['company.profile', 'market.quote', 'research.news'];
    const registry = createCapabilityRegistry(registered.map((id) => fakeCap(id)));

    const plan = planCapabilities('NVDA.US', registry);
    expect(plan).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);

    const byId = new Map(plan.map((p) => [p.capabilityId, p.available]));
    expect(byId.get('company.profile')).toBe(true);
    expect(byId.get('market.quote')).toBe(true);
    expect(byId.get('research.news')).toBe(true);
    expect(byId.get('market.kline')).toBe(false);
    expect(byId.get('company.valuation')).toBe(false);
  });
});

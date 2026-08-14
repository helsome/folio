import { describe, expect, it } from 'bun:test';
import { STRATEGY_IDS, TARGET_CAPABILITY_IDS } from '@finagent/core';
// NOTE: do not import @finagent/skill-hub here — the electron kernelHost test
// globally mocks that module (mock.module), which would empty the map under
// the full-suite bun test. The preset skill ids are pinned below against the
// real skillCapabilityMap keys (verified at authoring time).
import {
  COMPREHENSIVE_CAPABILITY_IDS,
  isStrategyId,
  RESEARCH_STRATEGIES,
} from './presets.ts';

const TARGET_SET = new Set<string>(TARGET_CAPABILITY_IDS);
const SKILL_SET = new Set<string>([
  'longbridge',
  'longbridge-portfolio',
  'longbridge-derivatives',
  'longbridge-intel',
  'longbridge-watchlist',
  'longbridge-value-investing',
  'longbridge-fundamentals',
  'longbridge-earnings',
  'longbridge-technical',
  'longbridge-content',
  'longbridge-research',
  'longbridge-quant',
  'longbridge-market-data',
]);

describe('strategy presets', () => {
  it('covers every StrategyId exactly once', () => {
    expect(Object.keys(RESEARCH_STRATEGIES).sort()).toEqual([...STRATEGY_IDS].sort());
    for (const id of STRATEGY_IDS) {
      expect(RESEARCH_STRATEGIES[id].id).toBe(id);
    }
  });

  it('only references real capability ids from TARGET_CAPABILITY_IDS', () => {
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      for (const capabilityId of strategy.capabilityIds) {
        expect(TARGET_SET.has(capabilityId)).toBe(true);
      }
      expect(strategy.capabilityIds.length).toBeGreaterThan(0);
    }
  });

  it('only references real skill ids from the skill hub map', () => {
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      for (const skillId of strategy.skillIds) {
        expect(SKILL_SET.has(skillId)).toBe(true);
      }
    }
  });

  it('orders every preset capability list as a subsequence of the comprehensive plan', () => {
    const canonical = new Map<string, number>(
      COMPREHENSIVE_CAPABILITY_IDS.map((id, index) => [id, index])
    );
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      const positions = strategy.capabilityIds.map((id) => canonical.get(id));
      const sorted = [...positions].sort((a, b) => (a ?? -1) - (b ?? -1));
      expect(positions).toEqual(sorted);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('makes comprehensive a superset of every other preset', () => {
    const comprehensive = new Set(RESEARCH_STRATEGIES.comprehensive.capabilityIds);
    for (const strategy of Object.values(RESEARCH_STRATEGIES)) {
      if (strategy.id === 'comprehensive') continue;
      for (const capabilityId of strategy.capabilityIds) {
        expect(comprehensive.has(capabilityId)).toBe(true);
      }
    }
  });

  it('guards unknown strategy ids', () => {
    for (const id of STRATEGY_IDS) {
      expect(isStrategyId(id)).toBe(true);
    }
    expect(isStrategyId('momentum')).toBe(false);
    expect(isStrategyId('')).toBe(false);
    expect(isStrategyId('constructor')).toBe(false);
  });
});

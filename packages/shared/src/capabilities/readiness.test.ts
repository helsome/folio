import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { FinanceCapability } from '@finagent/core';
import { createCapabilityRegistry } from './registry.ts';
import { defineCapability } from './define.ts';
import { computeSkillReadiness } from './readiness.ts';

function cap(id: string, toolName: string): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName,
    inputSchema: Type.Object({}),
    async execute() {
      return { data: {}, provenance: { provider: 'test', fetchedAt: 0, stale: false } };
    },
  });
}

describe('computeSkillReadiness', () => {
  const registry = createCapabilityRegistry([
    cap('market.quote', 'get_quote'),
    cap('market.kline', 'get_kline'),
  ]);

  it('ready when all required capabilities are present', () => {
    const readiness = computeSkillReadiness(
      'skill-a',
      { required: ['market.quote', 'market.kline'], optional: [] },
      registry
    );
    expect(readiness.status).toBe('ready');
    expect(readiness.summary).toBe('2/2 capabilities');
    expect(readiness.availableRequired).toBe(2);
    expect(readiness.missing).toEqual([]);
  });

  it('partial when only some required capabilities are present', () => {
    const readiness = computeSkillReadiness(
      'skill-b',
      { required: ['market.quote', 'market.intraday', 'company.profile'], optional: [] },
      registry
    );
    expect(readiness.status).toBe('partial');
    expect(readiness.summary).toBe('1/3 capabilities');
    expect(readiness.missing).toEqual(['market.intraday', 'company.profile']);
  });

  it('unavailable when no required capability is present', () => {
    const readiness = computeSkillReadiness(
      'skill-c',
      { required: ['research.news'], optional: [] },
      registry
    );
    expect(readiness.status).toBe('unavailable');
    expect(readiness.summary).toBe('0/1 capabilities');
    expect(readiness.missing).toEqual(['research.news']);
  });

  it('counts optional capabilities without affecting status', () => {
    const readiness = computeSkillReadiness(
      'skill-d',
      { required: ['market.quote'], optional: ['market.kline', 'market.intraday'] },
      registry
    );
    expect(readiness.status).toBe('ready');
    expect(readiness.availableOptional).toBe(1);
    expect(readiness.summary).toBe('1/1 capabilities');
  });
});

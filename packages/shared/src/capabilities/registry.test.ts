import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { CapabilityResult, FinanceCapability } from '@finagent/core';
import { createCapabilityRegistry } from './registry.ts';
import { defineCapability } from './define.ts';

function makeCap(id: string, toolName: string): FinanceCapability {
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
      return ok();
    },
  });
}

function ok(data: unknown = {}): CapabilityResult<unknown> {
  return { data, provenance: { provider: 'test', fetchedAt: 0, stale: false } };
}

describe('createCapabilityRegistry', () => {
  it('indexes capabilities by id and preserves registration order', () => {
    const registry = createCapabilityRegistry([
      makeCap('market.quote', 'get_quote'),
      makeCap('market.kline', 'get_kline'),
    ]);
    expect(registry.list().map((cap) => cap.id)).toEqual(['market.quote', 'market.kline']);
    expect(registry.get('market.quote')?.toolName).toBe('get_quote');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('rejects an invalid id format naming the offending manifest', () => {
    expect(() => createCapabilityRegistry([makeCap('Market.Quote', 'get_quote')]))
      .toThrow(/invalid id "Market.Quote"/);
    expect(() => createCapabilityRegistry([makeCap('market', 'get_quote')]))
      .toThrow(/invalid id "market"/);
  });

  it('rejects duplicate capability ids', () => {
    expect(() => createCapabilityRegistry([
      makeCap('market.quote', 'get_quote'),
      makeCap('market.quote', 'get_quote_v2'),
    ])).toThrow(/Duplicate capability id "market.quote"/);
  });

  it('rejects duplicate tool names', () => {
    expect(() => createCapabilityRegistry([
      makeCap('market.quote', 'get_quote'),
      makeCap('market.kline', 'get_quote'),
    ])).toThrow(/Duplicate toolName "get_quote"/);
  });

  it('filters by category, auth, and risk level', () => {
    const portfolio = defineCapability({
      id: 'portfolio.summary',
      name: 'Portfolio',
      description: 'test',
      category: 'portfolio',
      riskLevel: 'read',
      auth: 'account',
      toolName: 'get_portfolio',
      inputSchema: Type.Object({}),
      async execute() {
        return ok();
      },
    });
    const registry = createCapabilityRegistry([makeCap('market.quote', 'get_quote'), portfolio]);

    expect(registry.query({ category: 'market' }).map((cap) => cap.id)).toEqual(['market.quote']);
    expect(registry.query({ auth: 'account' }).map((cap) => cap.id)).toEqual(['portfolio.summary']);
    expect(registry.query({ riskLevel: 'read' })).toHaveLength(2);
    expect(registry.query({ category: 'research' })).toEqual([]);
  });
});

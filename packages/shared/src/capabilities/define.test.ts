import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'bun:test';
import { defineCapability } from './define.ts';

const base = {
  id: 'market.quote',
  name: 'Quote',
  description: 'test',
  category: 'market' as const,
  riskLevel: 'read' as const,
  auth: 'public' as const,
  toolName: 'get_quote',
  inputSchema: Type.Object({ symbol: Type.String() }),
};

describe('defineCapability', () => {
  it('copies instrumentId from stamped data onto provenance', async () => {
    const cap = defineCapability<{ symbol: string }, { symbol: string; instrumentId: string }>({
      ...base,
      async execute() {
        return {
          data: { symbol: 'AAPL.US', instrumentId: 'XNAS:AAPL' },
          provenance: { provider: 'longbridge', fetchedAt: 1, stale: false },
        };
      },
    });

    const result = await cap.execute({ symbol: 'AAPL.US' });
    expect(result.provenance.instrumentId).toBe('XNAS:AAPL');
  });

  it('copies instrumentId from array payloads', async () => {
    const cap = defineCapability<{ symbol: string }, Array<{ id: string; instrumentId: string }>>({
      ...base,
      async execute() {
        return {
          data: [{ id: 'n1', instrumentId: 'XNAS:AAPL' }],
          provenance: { provider: 'longbridge', fetchedAt: 1, stale: false },
        };
      },
    });

    const result = await cap.execute({ symbol: 'AAPL.US' });
    expect(result.provenance.instrumentId).toBe('XNAS:AAPL');
  });

  it('does not override an explicit provenance instrumentId', async () => {
    const cap = defineCapability<{ symbol: string }, { instrumentId: string }>({
      ...base,
      async execute() {
        return {
          data: { instrumentId: 'XNAS:AAPL' },
          provenance: {
            provider: 'longbridge',
            fetchedAt: 1,
            stale: false,
            instrumentId: 'XHKG:0700',
          },
        };
      },
    });

    const result = await cap.execute({ symbol: '0700.HK' });
    expect(result.provenance.instrumentId).toBe('XHKG:0700');
  });
});

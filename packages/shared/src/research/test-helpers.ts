import { Type } from '@sinclair/typebox';
import type { FinanceCapability } from '@finagent/core';

export type FakeCapMode = 'success' | 'fail' | 'unavailable' | 'slow';

/**
 * Minimal fake `FinanceCapability` (a plain object satisfying the contract —
 * `defineCapability` is not required in tests).
 */
export function fakeCap(id: string, mode: FakeCapMode = 'success'): FinanceCapability {
  return {
    id,
    name: id,
    description: `fake ${id}`,
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName: id.replace(/\./g, '_'),
    inputSchema: Type.Object({ symbol: Type.String() }),
    async execute(_input, ctx) {
      if (mode === 'slow') {
        return new Promise((_resolve, reject) => {
          ctx?.signal?.addEventListener('abort', () => reject(abortError(id)));
        });
      }
      if (mode === 'fail') {
        throw new Error(`fake failure for ${id}`);
      }
      if (mode === 'unavailable') {
        const error = new Error(`provider unavailable for ${id}`) as Error & { code: string };
        error.code = 'LONGBRIDGE_NOT_AUTHED';
        throw error;
      }
      return {
        data: sampleData(id),
        provenance: { provider: 'test', fetchedAt: 1_700_000_000_000, stale: false },
        summary: `${id} ok`,
      };
    },
  };
}

function sampleData(id: string): unknown {
  switch (id) {
    case 'market.quote':
      return { symbol: 'NVDA.US', change: 3 };
    case 'market.kline':
      return [
        { close: 100 },
        { close: 105 },
        { close: 115 },
      ];
    case 'company.valuation':
      return { pe: 25 };
    default:
      return { present: true };
  }
}

function abortError(id: string): Error {
  const error = new Error(`aborted ${id}`) as Error & { name: string };
  error.name = 'AbortError';
  return error;
}

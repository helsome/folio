import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { CapabilityResult, FinanceCapability } from '@finagent/core';
import { CapabilityExecutor } from './executor.ts';
import { defineCapability } from './define.ts';

function result(data: unknown = {}): CapabilityResult<unknown> {
  return { data, provenance: { provider: 'test', fetchedAt: 0, stale: false } };
}

function makeCap(id: string, toolName: string, execute: FinanceCapability['execute']): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName,
    inputSchema: Type.Object({}),
    execute,
  });
}

describe('CapabilityExecutor.run', () => {
  it('records success with provenance and result', async () => {
    const executor = new CapabilityExecutor({ now: () => 1000 });
    const cap = makeCap('market.quote', 'get_quote', async () => result({ p: 1 }));

    const { record, result: out } = await executor.run(cap, {});

    expect(record.status).toBe('success');
    expect(record.capabilityId).toBe('market.quote');
    expect(record.durationMs).toBe(0);
    expect(record.provenance).toEqual({ provider: 'test', fetchedAt: 0, stale: false });
    expect(out?.data).toEqual({ p: 1 });
  });

  it('records failed with the error message', async () => {
    const executor = new CapabilityExecutor();
    const cap = makeCap('market.quote', 'get_quote', async () => {
      throw new Error('boom');
    });

    const { record, result: out } = await executor.run(cap, {});

    expect(record.status).toBe('failed');
    expect(record.error).toBe('boom');
    expect(out).toBeUndefined();
  });

  it('maps provider auth errors to unavailable', async () => {
    const executor = new CapabilityExecutor();
    const cap = makeCap('market.quote', 'get_quote', async () => {
      throw Object.assign(new Error('LongBridge authentication is required'), {
        code: 'LONGBRIDGE_NOT_AUTHED',
      });
    });

    const { record } = await executor.run(cap, {});

    expect(record.status).toBe('unavailable');
  });

  it('records cancelled when a capability exceeds its timeout', async () => {
    const executor = new CapabilityExecutor();
    const cap = makeCap('market.quote', 'get_quote', async (_input, ctx) => {
      await new Promise((_resolve, reject) => {
        ctx?.signal?.addEventListener('abort', () => reject(ctx.signal?.reason ?? new Error('aborted')));
      });
      return result();
    });

    const { record } = await executor.run(cap, {}, { timeoutMs: 5 });

    expect(record.status).toBe('cancelled');
    expect(record.error).toContain('timed out');
  });

  it('records cancelled when the external signal aborts mid-run', async () => {
    const executor = new CapabilityExecutor();
    const controller = new AbortController();
    const cap = makeCap('market.quote', 'get_quote', async (_input, ctx) => {
      await new Promise((_resolve, reject) => {
        ctx?.signal?.addEventListener('abort', () => reject(ctx.signal?.reason ?? new Error('aborted')));
      });
      return result();
    });

    const running = executor.run(cap, {}, { signal: controller.signal });
    controller.abort(new Error('user cancelled'));
    const { record } = await running;

    expect(record.status).toBe('cancelled');
  });
});

describe('CapabilityExecutor.runAll', () => {
  it('isolates per-spec failure (Promise.allSettled semantics)', async () => {
    const executor = new CapabilityExecutor();
    const bad = makeCap('market.bad', 'get_bad', async () => {
      throw new Error('boom');
    });
    const good = makeCap('market.good', 'get_good', async () => result({ value: 42 }));

    const results = await executor.runAll([
      { cap: bad, input: {} },
      { cap: good, input: {} },
    ]);

    expect(results[0].record.status).toBe('failed');
    expect(results[1].record.status).toBe('success');
    expect(results[1].result?.data).toEqual({ value: 42 });
  });

  it('limits concurrency', async () => {
    const executor = new CapabilityExecutor();
    let active = 0;
    let maxActive = 0;
    const caps = [0, 1, 2, 3, 4].map((i) =>
      makeCap(`market.c${i}`, `get_c${i}`, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return result({ i });
      })
    );

    await executor.runAll(caps.map((cap) => ({ cap, input: {} })), { concurrency: 2 });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('marks remaining specs cancelled after abort', async () => {
    const executor = new CapabilityExecutor();
    const controller = new AbortController();
    const blocking = makeCap('market.block', 'get_block', async (_input, ctx) => {
      await new Promise((_resolve, reject) => {
        ctx?.signal?.addEventListener('abort', () => reject(ctx.signal?.reason ?? new Error('aborted')));
      });
      return result();
    });
    const quick = makeCap('market.quick', 'get_quick', async () => result());

    const running = executor.runAll(
      [
        { cap: blocking, input: {} },
        { cap: quick, input: {} },
        { cap: quick, input: {} },
      ],
      { concurrency: 1, signal: controller.signal }
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const results = await running;

    expect(results.map((r) => r.record.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });
});

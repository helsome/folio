/**
 * Tests for the #25 provider resilience layer: typed failure classification,
 * bounded retry/backoff (with the #17 run-budget gate), circuit breaker,
 * per-class TTL cache, stale downgrade semantics, and the router-level
 * integration scenarios the issue explicitly demands (429 / timeout / outage
 * fault injection + fallback provenance).
 *
 * All time is injected (fake clock + no-op sleep) except the timeout tests,
 * which use short real timers to prove the racing logic.
 */
import { describe, expect, it } from 'bun:test';
import type {
  CapabilityId,
  FinancialDataProvider,
  ProviderHealth,
  ProviderResult,
} from '@finagent/core';
import {
  backoffDelayMs,
  CircuitBreaker,
  classifyCapability,
  classifyFailure,
  DEFAULT_CACHE_TTL_MS,
  isRetryableError,
  isRetryableKind,
  runWithRetry,
  TypedProviderCache,
} from './resilience.ts';
import { ProviderRouter } from './router.ts';

function success<T>(providerId: string, data: T, fetchedAt = 1000): ProviderResult<T> {
  return {
    ok: true,
    data,
    provenance: { providerId, providerName: providerId, fetchedAt, stale: false },
  };
}

function failure(code: string, message = 'failed', retryable?: boolean): ProviderResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

type Script = (
  callNumber: number,
  signal?: AbortSignal
) => ProviderResult<unknown> | Promise<ProviderResult<unknown>>;

/** Provider whose responses are scripted per call number (fault injection). */
class ScriptedProvider implements FinancialDataProvider {
  kind = 'financial-data' as const;
  calls = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly caps: CapabilityId[],
    private readonly script: Script
  ) {}

  async status(): Promise<ProviderHealth> {
    return { status: 'connected', lastCheck: 1 };
  }
  capabilities(): CapabilityId[] {
    return [...this.caps];
  }
  markets() {
    return [{ id: 'US', name: 'United States' }];
  }
  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    this.calls += 1;
    void capabilityId;
    void input;
    const result = await this.script(this.calls, signal);
    return result as ProviderResult<T>;
  }
}

/** Mutable fake clock. */
function fakeClock(start = 10_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const noSleep = async (): Promise<void> => {};

// ── Typed failure model ───────────────────────────────────────────────────

describe('classifyFailure', () => {
  it('maps exact provider codes to failure kinds', () => {
    expect(classifyFailure('TIMEOUT')).toBe('timeout');
    expect(classifyFailure('RATE_LIMITED')).toBe('rate_limited');
    expect(classifyFailure('QUOTA_EXHAUSTED')).toBe('rate_limited');
    expect(classifyFailure('AUTH_EXPIRED')).toBe('auth');
    expect(classifyFailure('FORBIDDEN')).toBe('auth');
    expect(classifyFailure('UNSUPPORTED_MARKET')).toBe('unsupported');
    expect(classifyFailure('SERVICE_UNAVAILABLE')).toBe('upstream');
    expect(classifyFailure('NOT_FOUND')).toBe('not_found');
    expect(classifyFailure('EMPTY_RESULT')).toBe('empty');
    expect(classifyFailure('PARSE_FAILURE')).toBe('malformed');
    expect(classifyFailure('ABORTED')).toBe('aborted');
    expect(classifyFailure('NETWORK_ERROR')).toBe('network');
  });

  it('sniffs unknown codes case-insensitively and defaults unknown to "unknown"', () => {
    expect(classifyFailure('ReadTimeoutError')).toBe('timeout');
    expect(classifyFailure('http_503_upstream')).toBe('upstream');
    expect(classifyFailure('Http429')).toBe('rate_limited');
    expect(classifyFailure('BadCredential')).toBe('auth');
    expect(classifyFailure(undefined)).toBe('unknown');
    expect(classifyFailure('totally novel')).toBe('unknown');
  });

  it('only transient kinds are retryable; auth/config never is', () => {
    expect(isRetryableKind('timeout')).toBe(true);
    expect(isRetryableKind('rate_limited')).toBe(true);
    expect(isRetryableKind('upstream')).toBe(true);
    expect(isRetryableKind('network')).toBe(true);
    for (const kind of ['auth', 'unsupported', 'not_found', 'empty', 'malformed', 'aborted', 'unknown'] as const) {
      expect(isRetryableKind(kind)).toBe(false);
    }
  });

  it('explicit error.retryable=false overrides a retryable-looking code', () => {
    expect(isRetryableError({ code: 'TIMEOUT', message: '', retryable: false })).toBe(false);
    // explicit true can opt in, but ABORTED is never retried
    expect(isRetryableError({ code: 'EMPTY_RESULT', message: '', retryable: true })).toBe(true);
    expect(isRetryableError({ code: 'ABORTED', message: '', retryable: true })).toBe(false);
  });
});

// ── Backoff / retry ───────────────────────────────────────────────────────

describe('backoffDelayMs', () => {
  it('grows exponentially and caps at maxDelayMs', () => {
    const opts = { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, jitter: false };
    expect(backoffDelayMs(1, opts)).toBe(100);
    expect(backoffDelayMs(2, opts)).toBe(200);
    expect(backoffDelayMs(3, opts)).toBe(400);
    expect(backoffDelayMs(10, opts)).toBe(1000);
  });

  it('applies bounded 0.5–1.0 jitter with an injected random', () => {
    const opts = { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, jitter: true };
    expect(backoffDelayMs(1, { ...opts, random: () => 0 })).toBe(50);
    expect(backoffDelayMs(1, { ...opts, random: () => 1 })).toBe(100);
  });
});

describe('runWithRetry', () => {
  it('retries a 429 until success and reports attempts', async () => {
    const outcomes = [failure('RATE_LIMITED'), failure('RATE_LIMITED'), success('p', 'ok')];
    const result = await runWithRetry(async () => outcomes.shift()!, {
      maxAttempts: 3,
      sleep: noSleep,
    });
    expect(result.attempts).toBe(3);
    expect(result.result.ok).toBe(true);
    expect(result.stoppedByBudget).toBe(false);
  });

  it('never retries an auth failure', async () => {
    let calls = 0;
    const result = await runWithRetry(
      async () => {
        calls += 1;
        return failure('AUTH_EXPIRED');
      },
      { maxAttempts: 5, sleep: noSleep }
    );
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.result.ok).toBe(false);
  });

  it('stops at maxAttempts and returns the last error', async () => {
    let calls = 0;
    const result = await runWithRetry(
      async () => {
        calls += 1;
        return failure('SERVICE_UNAVAILABLE');
      },
      { maxAttempts: 2, sleep: noSleep }
    );
    expect(calls).toBe(2);
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) expect(result.result.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('stops retrying once the #17 run budget is exhausted', async () => {
    const budget = { exhausted: false, isExhausted(): boolean { return this.exhausted; } };
    let calls = 0;
    const result = await runWithRetry(
      async () => {
        calls += 1;
        if (calls === 1) budget.exhausted = true;
        return failure('TIMEOUT');
      },
      { maxAttempts: 4, sleep: noSleep, budget }
    );
    expect(calls).toBe(1);
    expect(result.stoppedByBudget).toBe(true);
  });
});

// ── Circuit breaker ───────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('opens after the failure threshold, skips traffic, then half-open probes and closes', () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: clock.now });

    expect(breaker.allowRequest()).toBe(true);
    breaker.recordFailure(); // 1/2 — still closed
    expect(breaker.snapshot().state).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
    breaker.recordFailure(); // 2/2 — open
    expect(breaker.snapshot().state).toBe('open');

    // open window: requests rejected without touching the provider
    expect(breaker.allowRequest()).toBe(false);

    // cooldown elapsed → one half-open probe
    clock.advance(5001);
    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.snapshot().state).toBe('half_open');
    expect(breaker.allowRequest()).toBe(false); // only one probe in flight
    breaker.recordSuccess();
    expect(breaker.snapshot().state).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('re-opens immediately when a half-open probe fails', () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: clock.now });
    breaker.allowRequest();
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    clock.advance(1001);
    breaker.allowRequest(); // half-open probe
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    expect(breaker.snapshot().openedAt).toBe(11_001);
  });
});

// ── Typed cache ───────────────────────────────────────────────────────────

describe('TypedProviderCache', () => {
  it('classifies capabilities into TTL classes', () => {
    expect(classifyCapability('market.quote')).toBe('quote');
    expect(classifyCapability('market.depth')).toBe('quote');
    expect(classifyCapability('market.kline')).toBe('history');
    expect(classifyCapability('company.financials')).toBe('fundamental');
    expect(classifyCapability('research.news')).toBe('fundamental');
    expect(classifyCapability('portfolio.positions')).toBe('portfolio');
    expect(DEFAULT_CACHE_TTL_MS.fundamental).toBeGreaterThan(DEFAULT_CACHE_TTL_MS.quote);
  });

  it('returns fresh then stale after the class TTL, then miss past maxStale', () => {
    const clock = fakeClock(0);
    const cache = new TypedProviderCache({
      ttls: { quote: 1000 },
      maxStaleMs: 5000,
      now: clock.now,
    });
    const prov = success('primary', { px: 1 });
    cache.set('market.quote', 'primary', { symbol: 'AAPL.US' }, prov.ok ? prov.data : null, prov.ok ? prov.provenance : undefined!);

    clock.advance(999);
    expect(cache.get('market.quote', 'primary', { symbol: 'AAPL.US' }).kind).toBe('fresh');
    clock.advance(2); // 1001 — stale but retained
    const stale = cache.get('market.quote', 'primary', { symbol: 'AAPL.US' });
    expect(stale.kind).toBe('stale');
    clock.advance(6000); // beyond ttl + maxStale
    expect(cache.get('market.quote', 'primary', { symbol: 'AAPL.US' }).kind).toBe('miss');
  });

  it('isolates keys by period/adjustment/provider and ignores key order', () => {
    const cache = new TypedProviderCache();
    expect(cache.buildKey('market.kline', 'p', { symbol: 'AAPL.US', period: '1d' })).not.toBe(
      cache.buildKey('market.kline', 'p', { symbol: 'AAPL.US', period: '1h' })
    );
    expect(cache.buildKey('market.kline', 'p', { period: '1d', symbol: 'AAPL.US', adjustment: 'qfq' })).not.toBe(
      cache.buildKey('market.kline', 'p', { symbol: 'AAPL.US', period: '1d', adjustment: 'none' })
    );
    expect(cache.buildKey('market.quote', 'primary', { symbol: 'X' })).not.toBe(
      cache.buildKey('market.quote', 'fallback', { symbol: 'X' })
    );
    // order-independent
    expect(cache.buildKey('market.kline', 'p', { symbol: 'AAPL.US', period: '1d' })).toBe(
      cache.buildKey('market.kline', 'p', { period: '1d', symbol: 'AAPL.US' })
    );
  });
});

// ── Router integration: retry / timeout / breaker / failover / cache ──────

describe('ProviderRouter resilience integration (#25)', () => {
  it('retries a 429 on the primary and never touches the fallback', async () => {
    const router = new ProviderRouter({
      retry: { maxAttempts: 3, sleep: noSleep, jitter: false },
    });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], (n) =>
      n < 3 ? failure('RATE_LIMITED') : success('primary', { v: 'live' })
    );
    let fallbackCalls = 0;
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], async () => {
      fallbackCalls += 1;
      return success('fallback', { v: 'f' });
    });
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ v: string }>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.v).toBe('live');
      expect(result.provenance.providerId).toBe('primary');
      expect(result.provenance.failoverTrail).toBeUndefined();
    }
    expect(primary.calls).toBe(3);
    expect(fallbackCalls).toBe(0);
  });

  it('tries an auth failure exactly once before falling back', async () => {
    const router = new ProviderRouter({ retry: { maxAttempts: 5, sleep: noSleep } });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], () =>
      failure('AUTH_EXPIRED')
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ v: string }>('market.quote', {});
    expect(result.ok).toBe(true);
    expect(primary.calls).toBe(1);
    if (result.ok) {
      expect(result.provenance.providerId).toBe('fallback');
      expect(result.provenance.failoverTrail).toEqual([
        expect.objectContaining({
          providerId: 'primary',
          code: 'AUTH_EXPIRED',
          kind: 'auth',
          attempts: 1,
        }),
      ]);
    }
  });

  it('records attempts + kind in the failover trail after exhausting retries', async () => {
    const router = new ProviderRouter({ retry: { maxAttempts: 2, sleep: noSleep } });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], () =>
      failure('SERVICE_UNAVAILABLE', '5xx')
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ v: string }>('market.quote', {});
    expect(result.ok).toBe(true);
    expect(primary.calls).toBe(2);
    if (result.ok) {
      expect(result.provenance.providerId).toBe('fallback');
      const trail = result.provenance.failoverTrail;
      expect(trail).toHaveLength(1);
      expect(trail?.[0]).toMatchObject({
        providerId: 'primary',
        code: 'SERVICE_UNAVAILABLE',
        kind: 'upstream',
        attempts: 2,
      });
      expect(typeof trail?.[0].at).toBe('number');
    }
  });

  it('times out a hung provider and serves the fallback with a trail', async () => {
    const router = new ProviderRouter({
      timeoutMs: 30,
      retry: { maxAttempts: 1 },
    });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], () =>
      new Promise((resolve) => setTimeout(() => resolve(success('primary', { v: 'late' })), 120))
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const start = Date.now();
    const result = await router.execute<{ v: string }>('market.quote', {});
    expect(Date.now() - start).toBeLessThan(110);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance.providerId).toBe('fallback');
      expect(result.provenance.failoverTrail?.[0].code).toBe('TIMEOUT');
      expect(result.provenance.failoverTrail?.[0].kind).toBe('timeout');
    }
  });

  it('skips an open breaker (outage fault injection) and probes again after cooldown', async () => {
    const clock = fakeClock();
    const router = new ProviderRouter({
      now: clock.now,
      breaker: { failureThreshold: 2, cooldownMs: 5000 },
      retry: { maxAttempts: 1, sleep: noSleep },
    });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], (n) =>
      n >= 3 ? success('primary', { v: 'recovered' }) : failure('SERVICE_UNAVAILABLE')
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    // two failed trips open the breaker
    for (let i = 0; i < 2; i += 1) {
      const r = await router.execute<{ v: string }>('market.quote', {});
      expect(r.ok && r.provenance.providerId).toBe('fallback');
    }
    expect(primary.calls).toBe(2);

    // third call: breaker open → primary is NOT called, trail shows CIRCUIT_OPEN
    const skipped = await router.execute<{ v: string }>('market.quote', {});
    expect(primary.calls).toBe(2);
    expect(skipped.ok).toBe(true);
    if (skipped.ok) {
      expect(skipped.provenance.providerId).toBe('fallback');
      expect(skipped.provenance.failoverTrail?.[0]).toMatchObject({
        providerId: 'primary',
        code: 'CIRCUIT_OPEN',
        attempts: 0,
      });
    }

    // after cooldown the half-open probe succeeds and closes the breaker
    clock.advance(5001);
    const recovered = await router.execute<{ v: string }>('market.quote', {});
    expect(primary.calls).toBe(3);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.data.v).toBe('recovered');
      expect(recovered.provenance.providerId).toBe('primary');
      expect(recovered.provenance.failoverTrail).toBeUndefined();
    }
  });

  it('serves fresh cache without calling any provider, keyed by period', async () => {
    const clock = fakeClock();
    const router = new ProviderRouter({
      now: clock.now,
      cache: { ttls: { history: 1000 }, now: clock.now },
    });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.kline'], () =>
      success('primary', { rows: [1, 2, 3] })
    );
    router.register(primary);
    router.setRouting({ primary: 'primary' });

    const first = await router.execute<{ rows: number[] }>('market.kline', {
      symbol: 'AAPL.US',
      period: '1d',
    });
    expect(first.ok && primary.calls).toBe(1);

    clock.advance(500);
    const second = await router.execute<{ rows: number[] }>('market.kline', {
      symbol: 'AAPL.US',
      period: '1d',
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.rows).toEqual([1, 2, 3]);
    expect(primary.calls).toBe(1); // served from cache

    // a different period is a different request
    await router.execute('market.kline', { symbol: 'AAPL.US', period: '1h' });
    expect(primary.calls).toBe(2);
  });

  it('downgrades to stale ONLY after every live provider fails, flagged stale with origin kept', async () => {
    const clock = fakeClock();
    const router = new ProviderRouter({
      now: clock.now,
      cache: { ttls: { quote: 1000 }, maxStaleMs: 60_000, now: clock.now },
      retry: { maxAttempts: 1, sleep: noSleep },
    });
    let primaryLive = true;
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], () =>
      primaryLive ? success('primary', { px: 100 }) : failure('SERVICE_UNAVAILABLE')
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      primaryLive ? success('fallback', { px: 100 }) : failure('RATE_LIMITED')
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    // prime the cache at t=0
    const live = await router.execute<{ px: number }>('market.quote', { symbol: 'AAPL.US' });
    expect(live.ok && live.provenance.stale).toBe(false);

    // entry goes stale at t=2000 and BOTH providers are now down
    clock.advance(2000);
    primaryLive = false;
    const downgraded = await router.execute<{ px: number }>('market.quote', { symbol: 'AAPL.US' });
    expect(downgraded.ok).toBe(true);
    if (downgraded.ok) {
      expect(downgraded.data.px).toBe(100);
      expect(downgraded.provenance.stale).toBe(true); // explicit downgrade
      expect(downgraded.provenance.providerId).toBe('primary'); // origin never rewritten
      expect(downgraded.provenance.failoverTrail?.map((s) => s.providerId)).toEqual([
        'primary',
        'fallback',
      ]);
    }

    // provider recovered → live value again, never stale
    primaryLive = true;
    const healed = await router.execute<{ px: number }>('market.quote', { symbol: 'AAPL.US' });
    expect(healed.ok).toBe(true);
    if (healed.ok) {
      expect(healed.provenance.stale).toBe(false);
      expect(healed.provenance.providerId).toBe('primary');
    }
  });

  it('supports per-capability provider preference overriding global routing', async () => {
    const router = new ProviderRouter();
    router.register(new ScriptedProvider('a', 'A', ['market.quote'], () => success('a', { v: 'a' })));
    router.register(new ScriptedProvider('b', 'B', ['market.quote'], () => success('b', { v: 'b' })));
    router.setRouting({ primary: 'a' });
    router.setCapabilityRouting('market.quote', { primary: 'b' });

    const result = await router.execute<{ v: string }>('market.quote', {});
    expect(result.ok && result.provenance.providerId).toBe('b');
    expect(router.getCapabilityRouting('market.quote')).toEqual({ primary: 'b' });
  });

  it('does not retry once the injected #17 run budget is exhausted', async () => {
    const budget = { exhausted: false, isExhausted(): boolean { return this.exhausted; } };
    const router = new ProviderRouter({
      retry: { maxAttempts: 4, sleep: noSleep, budget },
    });
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], (n) => {
      if (n === 1) budget.exhausted = true;
      return failure('TIMEOUT');
    });
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    await router.execute('market.quote', {});
    expect(primary.calls).toBe(1); // budget stopped further same-provider retries
  });

  it('keeps original default behavior with no resilience options (single attempt)', async () => {
    const router = new ProviderRouter();
    const primary = new ScriptedProvider('primary', 'Primary', ['market.quote'], () =>
      failure('TIMEOUT')
    );
    const fallback = new ScriptedProvider('fallback', 'Fallback', ['market.quote'], () =>
      success('fallback', { v: 'f' })
    );
    router.register(primary);
    router.register(fallback);
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ v: string }>('market.quote', {});
    expect(primary.calls).toBe(1); // no implicit retry
    expect(result.ok && result.provenance.providerId).toBe('fallback');
  });
});

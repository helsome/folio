import type {
  BrokerAccountProvider,
  CapabilityId,
  FinancialDataProvider,
  FinancialProviderRouter,
  ProviderCoverage,
  ProviderError,
  ProviderFailoverStep,
  ProviderProvenance,
  ProviderResult,
  ProviderRoutingConfig,
} from '@finagent/core';
import { isRecord } from '../guards.ts';
import { BROKER_CAPABILITY_IDS } from './coverage.ts';
import { ProviderRegistry, type AnyProvider } from './registry.ts';
import {
  CircuitBreakerRegistry,
  classifyFailure,
  runWithRetry,
  TypedProviderCache,
  type RetryOptions,
  type TypedCacheOptions,
} from './resilience.ts';

const ABORTED: ProviderError = { code: 'ABORTED', message: 'Request aborted' };

/** Snapshot of the last routing outcome for one provider (observability). */
export interface ProviderRuntimeResult {
  capabilityId: CapabilityId;
  providerId: string;
  ok: boolean;
  fallbackUsed: boolean;
  at: number;
  errorCode?: string;
}

function unsupported(capabilityId: CapabilityId): ProviderError {
  return {
    code: 'UNSUPPORTED_CAPABILITY',
    message: `No provider supports capability "${capabilityId}"`,
  };
}

/** A provider supports a capability it declared, or (brokers) a portfolio cap. */
function supports(provider: AnyProvider, capabilityId: CapabilityId): boolean {
  if (provider.kind === 'financial-data') {
    return provider.capabilities().includes(capabilityId);
  }
  return BROKER_CAPABILITY_IDS.includes(capabilityId);
}

function readAccountId(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const accountId = input.accountId;
  return typeof accountId === 'string' ? accountId : undefined;
}

function readOptions(input: unknown): unknown {
  if (!isRecord(input)) return undefined;
  return input.options;
}

/**
 * Opt-in resilience configuration (#25). Every field is optional; when the
 * whole object (or a field) is omitted, the router behaves exactly like the
 * original primary/fallback router — no retry, no breaker, no cache, no
 * timeout — so existing call sites and tests are unaffected.
 */
export interface ProviderResilienceOptions {
  /** Per-attempt wall-clock timeout; a slow provider fails with `TIMEOUT`. */
  timeoutMs?: number;
  /** Same-provider bounded retry policy (auth/aborted/malformed never retry). */
  retry?: RetryOptions;
  /** Per-provider circuit breaker tuning. */
  breaker?: { failureThreshold: number; cooldownMs: number };
  /** Enable the gateway-level, per-class-TTL result cache. */
  cache?: TypedCacheOptions;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
}

/**
 * All constructor options: resilience (#25) + runtime hooks (async routing
 * resolver, enablement gate) merged into one flat object.
 */
export type ProviderRouterOptions = ProviderResilienceOptions & {
  /** Async override for the global primary/fallback chain. */
  resolveRouting?: () => Promise<ProviderRoutingConfig>;
  /** Async enablement gate; disabled providers are skipped during routing. */
  isEnabled?: (providerId: string) => Promise<boolean>;
};

/**
 * PRIMARY + OPTIONAL FALLBACK router (spec §6). Candidate order is primary
 * then fallback; a provider that does not support the capability is skipped
 * (so an unsupported primary goes straight to the fallback). A primary
 * `ProviderError` (other than `ABORTED`) or timeout falls through to the
 * fallback, whose result carries the FALLBACK's provenance — never faked
 * (spec §62). `ABORTED` never triggers fallback.
 *
 * When {@link ProviderResilienceOptions} are supplied, each candidate gets a
 * timeout + bounded retry, an open circuit breaker skips it instantly, fresh
 * cache entries short-circuit the chain, and a stale cache entry is served
 * ONLY after every live candidate fails — with `provenance.stale = true` and
 * a `failoverTrail` explaining the downgrade (#25).
 */
export class ProviderRouter implements FinancialProviderRouter {
  private readonly registry = new ProviderRegistry();
  private routing: ProviderRoutingConfig = { primary: '' };

  // Runtime hooks (PR #70)
  private readonly resolveRouting?: () => Promise<ProviderRoutingConfig>;
  private readonly isEnabled?: (providerId: string) => Promise<boolean>;
  private readonly recentResults = new Map<string, ProviderRuntimeResult>();

  // Resilience (#25)
  private readonly capabilityRouting = new Map<CapabilityId, ProviderRoutingConfig>();
  private readonly now: () => number;
  private readonly timeoutMs?: number;
  private readonly retryOptions?: RetryOptions;
  private readonly breakers?: CircuitBreakerRegistry;
  private readonly cache?: TypedProviderCache;

  constructor(options: ProviderRouterOptions = {}) {
    this.resolveRouting = options.resolveRouting;
    this.isEnabled = options.isEnabled;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs;
    // Retry is opt-in: when no retry block is configured we force one attempt
    // (maxAttempts=1) so default routing is byte-for-byte unchanged.
    this.retryOptions = options.retry ? { ...options.retry } : { maxAttempts: 1 };
    if (options.breaker) {
      this.breakers = new CircuitBreakerRegistry({ ...options.breaker, now: this.now });
    }
    if (options.cache) {
      this.cache = new TypedProviderCache({ ...options.cache, now: this.now });
    }
  }

  register(provider: AnyProvider): void {
    this.registry.register(provider);
  }

  get(id: string): AnyProvider | undefined {
    return this.registry.get(id);
  }

  list(): AnyProvider[] {
    return this.registry.list();
  }

  setRouting(config: ProviderRoutingConfig): void {
    this.routing = { primary: config.primary, fallback: config.fallback };
  }

  getRouting(): ProviderRoutingConfig {
    return { primary: this.routing.primary, fallback: this.routing.fallback };
  }

  /** Last routing snapshot for one provider (observability, PR #70). */
  lastResultFor(providerId: string): ProviderRuntimeResult | undefined {
    const result = this.recentResults.get(providerId);
    return result ? { ...result } : undefined;
  }

  /**
   * Per-capability provider preference (#25): overrides the global
   * primary/fallback chain for one capability only.
   */
  setCapabilityRouting(capabilityId: CapabilityId, config: ProviderRoutingConfig): void {
    this.capabilityRouting.set(capabilityId, { primary: config.primary, fallback: config.fallback });
  }

  /** Read back a capability preference (test/observability). */
  getCapabilityRouting(capabilityId: CapabilityId): ProviderRoutingConfig | undefined {
    return this.capabilityRouting.get(capabilityId);
  }

  /** Drop every cached entry (settings change / explicit refresh). */
  clearCache(): void {
    this.cache?.clear();
  }

  coverage(): ProviderCoverage[] {
    return this.list().map((provider) => this.coverageFor(provider));
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (signal?.aborted) {
      return { ok: false, error: ABORTED };
    }

    // Routing resolution order: per-capability override → async resolver → static.
    const capabilityOverride = this.capabilityRouting.get(capabilityId);
    const routing = capabilityOverride
      ? capabilityOverride
      : this.resolveRouting
        ? await this.resolveRouting()
        : this.routing;

    const order = [routing.primary, routing.fallback].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );

    // Broker capabilities (portfolio.*) are served by broker providers which
    // are NOT part of the primary/fallback chain. When the configured chain
    // cannot cover a capability, fall back to any registered provider that
    // supports it (stable registry order) instead of failing the call.
    const chain: string[] = [...order];
    for (const provider of this.registry.list()) {
      if (!chain.includes(provider.id) && supports(provider, capabilityId)) {
        chain.push(provider.id);
      }
    }

    // Synchronous capability/coverage filter (isEnabled is async, checked in-loop).
    const candidates = chain.filter((id) => {
      const provider = this.get(id);
      return Boolean(provider) && supports(provider as AnyProvider, capabilityId);
    });

    // 1) Fresh cache short-circuit, consulted in routing order so the primary's
    //    fresh value always wins over the fallback's.
    if (this.cache) {
      const cached = this.readFresh<T>(candidates, capabilityId, input);
      if (cached) return cached;
    }

    const trail: ProviderFailoverStep[] = [];
    let lastError: ProviderError | undefined;

    // 2) Live chain: enablement gate → timeout → bounded retry → circuit breaker.
    for (const id of candidates) {
      const provider = this.get(id) as AnyProvider;

      // Async enablement gate (PR #70): disabled providers are skipped.
      if (this.isEnabled && !(await this.isEnabled(id))) {
        continue;
      }

      const breaker = this.breakers?.forProvider(id);
      if (breaker && !breaker.allowRequest()) {
        trail.push({
          providerId: id,
          code: 'CIRCUIT_OPEN',
          kind: 'upstream',
          attempts: 0,
          at: this.now(),
        });
        lastError = { code: 'CIRCUIT_OPEN', message: `Provider "${id}" circuit is open` };
        continue;
      }

      const outcome = await runWithRetry<T>((attempt) => {
        void attempt;
        return this.invokeWithTimeout<T>(provider, capabilityId, input, signal);
      }, this.retryOptions);

      // Record the last routing outcome for this provider (observability).
      this.recentResults.set(id, {
        capabilityId,
        providerId: id,
        ok: outcome.result.ok,
        fallbackUsed: id !== order[0],
        at: this.now(),
        errorCode: outcome.result.ok ? undefined : outcome.result.error.code,
      });

      if (outcome.result.ok) {
        breaker?.recordSuccess();
        const provenance = this.attachTrail(outcome.result.provenance, trail);
        const data = outcome.result.data;
        if (this.cache) this.cache.set(capabilityId, id, input, data, provenance);
        return { ok: true, data, provenance };
      }

      breaker?.recordFailure();
      const error = outcome.result.error;
      trail.push({
        providerId: id,
        code: error.code,
        kind: classifyFailure(error.code),
        attempts: outcome.attempts,
        at: this.now(),
      });
      lastError = error;
      if (error.code === 'ABORTED') {
        return { ok: false, error: this.attachTrailToError(error, trail) };
      }
    }

    // 3) Every live candidate failed: serve a STALE cache entry only as an
    //    explicit downgrade, never disguised as a live value (#25 AC).
    if (this.cache) {
      const stale = this.readStale<T>(candidates, capabilityId, input, trail);
      if (stale) return stale;
    }

    if (lastError) {
      return { ok: false, error: this.attachTrailToError(lastError, trail) };
    }
    return { ok: false, error: unsupported(capabilityId) };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private attachTrail(provenance: ProviderProvenance, trail: ProviderFailoverStep[]): ProviderProvenance {
    if (trail.length === 0) return provenance;
    return { ...provenance, failoverTrail: trail.map((step) => ({ ...step })) };
  }

  private attachTrailToError(error: ProviderError, trail: ProviderFailoverStep[]): ProviderError {
    if (trail.length === 0) return error;
    return { ...error, failoverTrail: trail.map((step) => ({ ...step })) };
  }

  private readFresh<T>(
    candidates: string[],
    capabilityId: CapabilityId,
    input: unknown
  ): ProviderResult<T> | undefined {
    if (!this.cache) return undefined;
    for (const id of candidates) {
      const lookup = this.cache.get<T>(capabilityId, id, input);
      if (lookup.kind === 'fresh') {
        return { ok: true, data: lookup.record.data, provenance: { ...lookup.record.provenance } };
      }
    }
    return undefined;
  }

  private readStale<T>(
    candidates: string[],
    capabilityId: CapabilityId,
    input: unknown,
    trail: ProviderFailoverStep[]
  ): ProviderResult<T> | undefined {
    if (!this.cache) return undefined;
    for (const id of candidates) {
      const lookup = this.cache.get<T>(capabilityId, id, input);
      if (lookup.kind === 'stale') {
        // Explicit downgrade: keep the ACTUAL origin provider, force stale,
        // and attach the live-failure trail. A consumer can always tell this
        // is cached history, never a fresh quote.
        const provenance: ProviderProvenance = {
          ...lookup.record.provenance,
          stale: true,
          failoverTrail: trail.map((step) => ({ ...step })),
        };
        return { ok: true, data: lookup.record.data, provenance };
      }
    }
    return undefined;
  }

  /**
   * Invoke one provider with an optional wall-clock timeout. The provider
   * receives an internal AbortSignal that fires on either timeout or external
   * cancellation; an external abort surfaces as ABORTED, a timeout as TIMEOUT.
   */
  private async invokeWithTimeout<T>(
    provider: AnyProvider,
    capabilityId: CapabilityId,
    input: unknown,
    externalSignal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (!this.timeoutMs) {
      return this.invoke<T>(provider, capabilityId, input, externalSignal);
    }

    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      settled = true;
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    };
    const onExternalAbort = (): void => {
      controller.abort();
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
      }
    };
    externalSignal?.addEventListener('abort', onExternalAbort);

    const work = this.invoke<T>(provider, capabilityId, input, controller.signal).then(
      (result) => {
        cleanup();
        return result;
      },
      (error: unknown) => {
        cleanup();
        return {
          ok: false as const,
          error: { code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'provider threw' },
        };
      }
    );

    const timeout = new Promise<ProviderResult<T>>((resolve) => {
      timer = setTimeout(() => {
        if (settled) return;
        controller.abort();
        cleanup();
        resolve({
          ok: false,
          error: {
            code: 'TIMEOUT',
            message: `Provider "${provider.id}" timed out after ${this.timeoutMs}ms`,
            retryable: true,
          },
        });
      }, this.timeoutMs);
    });

    const externalAbort = new Promise<ProviderResult<T>>((resolve) => {
      if (!externalSignal) return;
      externalSignal.addEventListener('abort', () => {
        cleanup();
        resolve({ ok: false, error: ABORTED });
      });
    });

    return Promise.race([work, timeout, externalAbort]);
  }

  private coverageFor(provider: AnyProvider): ProviderCoverage {
    if (provider.kind === 'financial-data') {
      return {
        providerId: provider.id,
        capabilities: provider.capabilities(),
        markets: provider.markets(),
        dataAccess: provider.id === 'massive' ? 'end-of-day' : 'live',
        credentialRequirement: provider.id === 'massive' ? 'api-key' : 'device-login',
        quota: provider.id === 'massive' ? { limit: 5, window: 'minute' } : undefined,
      };
    }
    return {
      providerId: provider.id,
      capabilities: [...BROKER_CAPABILITY_IDS],
      markets: [],
      credentialRequirement: 'device-login',
    };
  }

  private async invoke<T>(
    provider: AnyProvider,
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (provider.kind === 'financial-data') {
      return provider.execute<T>(capabilityId, input, signal);
    }
    const result = await this.invokeBroker(provider, capabilityId, input, signal);
    const typed = result as ProviderResult<T>;
    return typed;
  }

  private async invokeBroker(
    provider: BrokerAccountProvider,
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<unknown>> {
    const accountId = readAccountId(input);
    switch (capabilityId) {
      case 'portfolio.summary':
        return provider.getPortfolio(accountId, signal);
      case 'portfolio.positions':
        return provider.getPositions(accountId, signal);
      case 'portfolio.assets':
        return provider.getAssets(accountId, signal);
      case 'portfolio.cashFlow':
        return provider.getCashFlow(accountId, readOptions(input), signal);
      default:
        return { ok: false, error: unsupported(capabilityId) };
    }
  }
}

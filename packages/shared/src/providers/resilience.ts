/**
 * Provider resilience layer (#25).
 *
 * Four small, independently testable primitives that `ProviderRouter`
 * composes around the existing primary/fallback chain:
 *
 *   1. {@link FailureKind} / {@link classifyFailure} — one typed model for
 *      every provider failure (timeout / network / rate-limit / auth /
 *      unsupported / upstream 5xx / not-found / empty / malformed / aborted).
 *   2. {@link runWithRetry} — bounded retry with exponential backoff +
 *      jitter. Auth/config and other deterministic failures are NEVER retried;
 *      an optional {@link RetryBudget} lets the #17 run budget cap retries.
 *   3. {@link CircuitBreaker} / {@link CircuitBreakerRegistry} — per-provider
 *      closed/open/half-open state so a hard-down provider is skipped fast
 *      instead of making every request wait for its timeout.
 *   4. {@link TypedProviderCache} — gateway-level cache whose TTL varies by
 *      data CLASS (quote vs history vs fundamental …) and whose key carries
 *      instrument/provider/period/adjustment dimensions. Stale entries are
 *      returned ONLY on explicit downgrade and always flagged `stale: true`,
 *      so a historical cache value can never impersonate a live quote.
 *
 * Design constraints:
 *  - Pure framework code: no vendor knowledge, no canonical-data semantics
 *    (reconciliation is #26, fact-envelope semantics are #24).
 *  - Everything is OPT-IN. A `ProviderRouter` built without resilience options
 *    behaves exactly as before, which keeps the existing tests valid.
 *  - Time is injectable (`now`/`sleep`/`random`) so every path is
 *    deterministically testable without real clocks or real providers.
 */
import type {
  CapabilityId,
  ProviderError,
  ProviderProvenance,
  ProviderResult,
} from '@finagent/core';

// ── 1. Typed failure model ────────────────────────────────────────────────

/**
 * The canonical failure classes the gateway has a POLICY for. Free-form
 * provider `code` strings are normalized into this closed union by
 * {@link classifyFailure}; routing/retry/breaker decisions always switch on
 * the kind, never on string-matching scattered across call sites.
 */
export type FailureKind =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'auth'
  | 'unsupported'
  | 'upstream'
  | 'not_found'
  | 'empty'
  | 'malformed'
  | 'aborted'
  | 'unknown';

/**
 * Exact `ProviderError.code` → kind table. Codes are upper-snake across the
 * existing adapters; the table covers every code currently emitted plus the
 * obvious synonyms a new adapter might choose.
 */
const CODE_KIND_TABLE: Record<string, FailureKind> = {
  // timeout / abort
  TIMEOUT: 'timeout',
  DEADLINE_EXCEEDED: 'timeout',
  REQUEST_TIMEOUT: 'timeout',
  GATEWAY_TIMEOUT: 'timeout',
  ABORTED: 'aborted',
  CANCELLED: 'aborted',
  // transport
  NETWORK_ERROR: 'network',
  CONNECTION_ERROR: 'network',
  CONNECTION_RESET: 'network',
  DNS_ERROR: 'network',
  OFFLINE: 'network',
  // quota
  RATE_LIMITED: 'rate_limited',
  QUOTA_EXHAUSTED: 'rate_limited',
  TOO_MANY_REQUESTS: 'rate_limited',
  // auth / config — never blindly retry
  AUTH_EXPIRED: 'auth',
  UNAUTHORIZED: 'auth',
  FORBIDDEN: 'auth',
  AUTH_CONFIG: 'auth',
  CONFIG_ERROR: 'auth',
  INVALID_CREDENTIAL: 'auth',
  // capability / market coverage
  UNSUPPORTED_CAPABILITY: 'unsupported',
  UNSUPPORTED_MARKET: 'unsupported',
  NOT_SUPPORTED: 'unsupported',
  // upstream server
  UPSTREAM_ERROR: 'upstream',
  BAD_GATEWAY: 'upstream',
  SERVICE_UNAVAILABLE: 'upstream',
  INTERNAL_SERVER_ERROR: 'upstream',
  // absent data
  NOT_FOUND: 'not_found',
  EMPTY_RESULT: 'empty',
  NO_DATA: 'empty',
  // bad payload
  PARSE_FAILURE: 'malformed',
  MALFORMED_RESULT: 'malformed',
  STALE_RESULT: 'malformed',
  INVALID_RESPONSE: 'malformed',
};

/**
 * Normalize a free-form provider error code (or a thrown Error) into a
 * {@link FailureKind}. Unknown codes fall back to keyword sniffing and then
 * `'unknown'`, which is treated as non-retryable to stay safe.
 *
 * Multi-scenario examples:
 *   classifyFailure('RATE_LIMITED')        // 'rate_limited'
 *   classifyFailure('HTTP_503')            // 'upstream'  (sniffed)
 *   classifyFailure('ReadTimeout')         // 'timeout'   (sniffed, case-insens)
 *   classifyFailure(undefined)             // 'unknown'
 *   classifyFailure('something weird')     // 'unknown'
 */
export function classifyFailure(code: string | undefined | null): FailureKind {
  if (!code) return 'unknown';
  const exact = CODE_KIND_TABLE[code.toUpperCase()];
  if (exact) return exact;

  const upper = code.toUpperCase();
  if (upper.includes('TIMEOUT') || upper.includes('DEADLINE')) return 'timeout';
  if (upper.includes('RATE') || upper.includes('QUOTA') || upper.includes('429')) return 'rate_limited';
  if (upper.includes('AUTH') || upper.includes('CREDENTIAL') || upper === '401' || upper === '403') {
    return 'auth';
  }
  if (upper.includes('UNSUPPORTED') || upper.includes('NOT_SUPPORTED')) return 'unsupported';
  if (upper.includes('NETWORK') || upper.includes('CONNECTION') || upper.includes('OFFLINE')) {
    return 'network';
  }
  if (upper.includes('5') && (upper.includes('502') || upper.includes('503') || upper.includes('500'))) {
    return 'upstream';
  }
  if (upper.includes('NOT_FOUND') || upper === '404') return 'not_found';
  if (upper.includes('EMPTY') || upper.includes('NO_DATA')) return 'empty';
  if (upper.includes('PARSE') || upper.includes('MALFORMED') || upper.includes('STALE')) return 'malformed';
  if (upper.includes('ABORT') || upper.includes('CANCEL')) return 'aborted';
  return 'unknown';
}

/**
 * Kinds where an immediate, SAME-provider retry may help: transient server /
 * transport / quota pressure only. Everything else (auth, malformed payload,
 * not-found, unsupported, abort, unknown) fails fast — retrying a deterministic
 * failure just burns the #17 run budget.
 */
const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'timeout',
  'network',
  'rate_limited',
  'upstream',
]);

/** Whether this failure kind is eligible for a same-provider retry. */
export function isRetryableKind(kind: FailureKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

/**
 * Final retry decision for one provider error. An explicit
 * `error.retryable === false` ALWAYS wins (a provider/adapter may know a
 * transient-looking code is actually terminal), and `error.retryable === true`
 * can opt a normally-non-retryable kind into one more attempt.
 */
export function isRetryableError(error: ProviderError): boolean {
  const kind = classifyFailure(error.code);
  if (error.retryable === false) return false;
  if (error.retryable === true) return kind !== 'aborted';
  return isRetryableKind(kind);
}

// ── 2. Bounded retry + backoff ────────────────────────────────────────────

/** Hook into the enclosing run's #17 budget; retries stop once exhausted. */
export interface RetryBudget {
  /** True when the owning Agent/Deep-Research run has spent its budget. */
  isExhausted(): boolean;
}

export interface RetryOptions {
  /** Total attempts against ONE provider including the first (1 = no retry). */
  maxAttempts?: number;
  /** Delay before the second attempt, ms. */
  baseDelayMs?: number;
  /** Exponential growth factor per failed attempt. */
  factor?: number;
  /** Backoff is capped at this value, ms. */
  maxDelayMs?: number;
  /** Multiply each delay by a random 0.5–1.0 factor to avoid thundering herd. */
  jitter?: boolean;
  /** Injectable wait (tests pass an immediate no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable random in [0,1) (tests pass a constant for determinism). */
  random?: () => number;
  /** Optional #17 run-budget gate. */
  budget?: RetryBudget;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_FACTOR = 2;
const DEFAULT_MAX_DELAY_MS = 5_000;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pure backoff schedule. `attempt` is the attempt that just failed (1-based);
 * the returned value is the wait before attempt `attempt + 1`.
 *
 *   backoffDelayMs(1, {baseDelayMs:200, factor:2}, () => 1) // 200
 *   backoffDelayMs(2, {baseDelayMs:200, factor:2}, () => 1) // 400
 *   backoffDelayMs(4, {baseDelayMs:200, factor:2, maxDelayMs:5000}, () => 1) // 5000 (capped)
 *   // jitter=false (or random omitted) → deterministic full delay
 */
export function backoffDelayMs(
  attempt: number,
  options: Pick<RetryOptions, 'baseDelayMs' | 'factor' | 'maxDelayMs' | 'jitter'> & { random?: () => number },
): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const cap = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const raw = base * Math.pow(factor, Math.max(0, attempt - 1));
  const capped = Math.min(raw, cap);
  if (!options.jitter) return Math.round(capped);
  const rand = options.random ?? Math.random;
  // 0.5–1.0 of the scheduled delay: bounded jitter, never zero.
  return Math.round(capped * (0.5 + rand() * 0.5));
}

export interface RetryOutcome<T> {
  result: ProviderResult<T>;
  /** Attempts actually made against the provider (≥1). */
  attempts: number;
  /** True when the loop stopped because the #17 run budget was spent. */
  stoppedByBudget: boolean;
}

/**
 * Run a provider operation with bounded retry. The operation receives the
 * 1-based attempt number so adapters could, for example, mark the last attempt.
 *
 * Stop rules (in order): success → return; non-retryable error → return
 * immediately; last attempt → return; aborted → return; budget exhausted →
 * return; otherwise backoff and retry. Auth/config errors therefore get
 * exactly ONE attempt, satisfying "#25: auth must not be retried infinitely".
 */
export async function runWithRetry<T>(
  operation: (attempt: number) => Promise<ProviderResult<T>>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep ?? realSleep;
  let stoppedByBudget = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await operation(attempt);

    if (result.ok) return { result, attempts: attempt, stoppedByBudget };
    if (!isRetryableError(result.error)) return { result, attempts: attempt, stoppedByBudget };
    if (result.error.code === 'ABORTED') return { result, attempts: attempt, stoppedByBudget };
    if (attempt === maxAttempts) return { result, attempts: attempt, stoppedByBudget };

    if (options.budget?.isExhausted()) {
      stoppedByBudget = true;
      return { result, attempts: attempt, stoppedByBudget };
    }

    const delay = backoffDelayMs(attempt, options);
    if (delay > 0) await sleep(delay);
  }

  // Unreachable in practice (loop always returns), kept for the type checker.
  throw new Error('runWithRetry: exhausted loop without a result');
}

// ── 3. Circuit breaker ────────────────────────────────────────────────────

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. Infinity disables it. */
  failureThreshold: number;
  /** Time an opened breaker stays open before a probe is allowed, ms. */
  cooldownMs: number;
  now?: () => number;
}

export interface BreakerSnapshot {
  state: BreakerState;
  failures: number;
  openedAt: number | undefined;
}

/**
 * Per-provider circuit breaker, classic three-state model:
 *  - closed: traffic flows; consecutive failures accrue.
 *  - open: traffic is rejected immediately (the router moves to the next
 *    provider) until `cooldownMs` elapses.
 *  - half_open: exactly ONE probe is let through; success closes the breaker,
 *    failure re-opens it and restarts the cooldown.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt: number | undefined;
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Whether a request may reach this provider right now. */
  allowRequest(): boolean {
    if (this.options.failureThreshold === Infinity) return true;

    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (this.openedAt !== undefined && this.now() - this.openedAt >= this.options.cooldownMs) {
        this.state = 'half_open';
        this.probing = true;
        return true;
      }
      return false;
    }

    // half_open: only one in-flight probe at a time.
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  /** Record a successful response; a surviving probe closes the breaker. */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = undefined;
    this.probing = false;
  }

  /** Record a failure; open the breaker when the threshold is reached. */
  recordFailure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  snapshot(): BreakerSnapshot {
    return { state: this.state, failures: this.failures, openedAt: this.openedAt };
  }
}

/** Lazily creates one breaker per provider id. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly options: Omit<CircuitBreakerOptions, 'now'> & { now?: () => number },
  ) {}

  forProvider(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: this.options.failureThreshold,
        cooldownMs: this.options.cooldownMs,
        now: this.options.now,
      });
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  /** Test/observability helper. */
  snapshots(): Record<string, BreakerSnapshot> {
    const out: Record<string, BreakerSnapshot> = {};
    for (const [id, breaker] of this.breakers) out[id] = breaker.snapshot();
    return out;
  }
}

// ── 4. Typed, per-class TTL cache ─────────────────────────────────────────

/**
 * Data freshness CLASS. TTL is chosen by class (issue #25 requirement: TTL by
 * data type, never one global duration).
 *  - quote/portfolio: near-live, very short TTL.
 *  - history (kline): short TTL, paging/period makes refetch costlier.
 *  - fundamental (company profile/financials/valuations/news): long TTL.
 */
export type CacheDataClass = 'quote' | 'history' | 'fundamental' | 'portfolio' | 'default';

/** Classify a capability id into a cache freshness class. */
export function classifyCapability(capabilityId: CapabilityId): CacheDataClass {
  if (capabilityId.startsWith('portfolio.')) return 'portfolio';
  if (capabilityId === 'market.kline' || capabilityId === 'market.intraday') return 'history';
  if (
    capabilityId.startsWith('company.') ||
    capabilityId.startsWith('research.') ||
    capabilityId === 'market.sentiment'
  ) {
    return 'fundamental';
  }
  if (capabilityId.startsWith('market.')) return 'quote';
  return 'default';
}

/** Conservative default TTLs, ms. Overridable per class. */
export const DEFAULT_CACHE_TTL_MS: Record<CacheDataClass, number> = {
  quote: 15_000,
  history: 60_000,
  fundamental: 30 * 60_000,
  portfolio: 15_000,
  default: 30_000,
};

/**
 * Input fields that distinguish two requests for the SAME capability. This is
 * an explicit WHITELIST — transient fields (signal, options bags, request
 * metadata) must never enter the key, and the picked fields are serialized in
 * sorted order so key construction is order-independent. Includes the issue's
 * required dimensions: instrument, period and adjustment.
 */
const KEY_FIELDS = [
  'symbol',
  'instrument',
  'instrumentId',
  'ticker',
  'period',
  'interval',
  'adjustment',
  'adjust',
  'accountId',
  'market',
  'limit',
] as const;

interface CacheRecord<T> {
  capabilityId: CapabilityId;
  providerId: string;
  data: T;
  provenance: ProviderProvenance;
  dataClass: CacheDataClass;
  storedAt: number;
  expiresAt: number;
}

export type CacheLookup<T> =
  | { kind: 'miss' }
  | { kind: 'fresh'; record: CacheRecord<T> }
  | { kind: 'stale'; record: CacheRecord<T> };

export interface TypedCacheOptions {
  /** Per-class TTL overrides. */
  ttls?: Partial<Record<CacheDataClass, number>>;
  /**
   * How long past expiry a stale entry is retained for explicit downgrade.
   * Default Infinity = retain until evicted by a newer value; the router only
   * ever serves it when every live provider fails.
   */
  maxStaleMs?: number;
  now?: () => number;
}

/**
 * Gateway-level result cache. The cache is provider-scoped (a fallback's value
 * is cached under the fallback id, never under the primary's) and returns
 * three explicit outcomes — miss / fresh / stale — so callers cannot mistake
 * stale data for live data.
 */
export class TypedProviderCache {
  private readonly records = new Map<string, CacheRecord<unknown>>();
  private readonly ttls: Record<CacheDataClass, number>;
  private readonly now: () => number;

  constructor(private readonly options: TypedCacheOptions = {}) {
    this.ttls = { ...DEFAULT_CACHE_TTL_MS, ...(options.ttls ?? {}) };
    this.now = options.now ?? Date.now;
  }

  /**
   * Stable cache key: capability + actual provider + whitelisted input
   * dimensions, JSON-serialized with sorted keys. Examples:
   *   ('market.quote','longbridge',{symbol:'AAPL.US'})
   *     → 'market.quote|longbridge|{"symbol":"AAPL.US"}'
   *   ('market.kline','massive',{symbol:'AAPL.US',period:'1d',adjustment:'forward'})
   *     → distinct from period:'1h' or adjustment:'none' (no cross-period hits)
   */
  buildKey(capabilityId: CapabilityId, providerId: string, input: unknown): string {
    const picked: Record<string, unknown> = {};
    if (input !== null && typeof input === 'object') {
      const source = input as Record<string, unknown>;
      for (const field of KEY_FIELDS) {
        const value = source[field];
        if (value !== undefined && value !== null) picked[field] = value;
      }
    } else if (input !== undefined && input !== null) {
      picked.value = input;
    }
    return `${capabilityId}|${providerId}|${stableStringify(picked)}`;
  }

  /** Look up an entry, distinguishing fresh vs explicitly-stale. */
  get<T>(capabilityId: CapabilityId, providerId: string, input: unknown): CacheLookup<T> {
    const key = this.buildKey(capabilityId, providerId, input);
    const record = this.records.get(key) as CacheRecord<T> | undefined;
    if (!record) return { kind: 'miss' };

    const now = this.now();
    if (now < record.expiresAt) return { kind: 'fresh', record };

    const maxStaleMs = this.options.maxStaleMs ?? Infinity;
    if (now - record.storedAt <= record.expiresAt - record.storedAt + maxStaleMs) {
      return { kind: 'stale', record };
    }
    this.records.delete(key);
    return { kind: 'miss' };
  }

  /** Store a successful result under its ACTUAL provider with a class TTL. */
  set<T>(
    capabilityId: CapabilityId,
    providerId: string,
    input: unknown,
    data: T,
    provenance: ProviderProvenance,
  ): CacheRecord<T> {
    const key = this.buildKey(capabilityId, providerId, input);
    const dataClass = classifyCapability(capabilityId);
    const now = this.now();
    const record: CacheRecord<T> = {
      capabilityId,
      providerId,
      data,
      provenance,
      dataClass,
      storedAt: now,
      expiresAt: now + this.ttls[dataClass],
    };
    this.records.set(key, record as CacheRecord<unknown>);
    return record;
  }

  clear(): void {
    this.records.clear();
  }

  /** Number of retained entries (test/observability). */
  get size(): number {
    return this.records.size;
  }
}

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

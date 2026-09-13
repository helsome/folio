// Financial Provider Platform (V4) — router, registry, coverage, connections,
// router-backed fetchers, health aggregation, and the #25 resilience layer.
export { ProviderRegistry, type AnyProvider } from './registry.ts';
export { ProviderRouter, type ProviderResilienceOptions } from './router.ts';
export { BROKER_CAPABILITY_IDS, capabilityMapping } from './coverage.ts';
export { ConnectionStore, type ConnectionState } from './connection.ts';
export {
  ProviderFetchError,
  createRouterFetchers,
  type RouterCapabilityFetchers,
  type RouterFetcherOptions,
} from './router-fetchers.ts';
export {
  InstrumentCatalogStore,
  INSTRUMENT_CATALOG_FILE,
  attachResolvedInstrument,
  bindProviderInput,
  stampInstrumentId,
  stampProviderResult,
} from './instrument.ts';
export { healthAll } from './health.ts';
export { MassiveFinancialDataProvider } from './massive/index.ts';
export { TtlCache } from './massive/cache.ts';
export {
  // typed failure model
  classifyFailure,
  isRetryableKind,
  isRetryableError,
  type FailureKind,
  // bounded retry
  runWithRetry,
  backoffDelayMs,
  type RetryOptions,
  type RetryBudget,
  type RetryOutcome,
  // circuit breaker
  CircuitBreaker,
  CircuitBreakerRegistry,
  type BreakerState,
  type BreakerSnapshot,
  type CircuitBreakerOptions,
  // typed TTL cache
  TypedProviderCache,
  classifyCapability,
  DEFAULT_CACHE_TTL_MS,
  type CacheDataClass,
  type CacheLookup,
  type TypedCacheOptions,
} from './resilience.ts';

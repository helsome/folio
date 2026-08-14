// Financial Provider Platform (V4) — router, registry, coverage, connections,
// router-backed fetchers, and health aggregation.
export { ProviderRegistry, type AnyProvider } from './registry.ts';
export { ProviderRouter } from './router.ts';
export { BROKER_CAPABILITY_IDS, capabilityMapping } from './coverage.ts';
export { ConnectionStore, type ConnectionState } from './connection.ts';
export {
  ProviderFetchError,
  createRouterFetchers,
  type RouterCapabilityFetchers,
} from './router-fetchers.ts';
export { healthAll } from './health.ts';
export { MassiveFinancialDataProvider } from './massive/index.ts';
export { TtlCache } from './massive/cache.ts';

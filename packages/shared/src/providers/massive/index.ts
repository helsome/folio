/**
 * Massive (Polygon.io) — minimal secondary market-data adapter.
 *
 * Proves the V4 router architecture (spec §13): a market-data-only
 * `FinancialDataProvider` serving US quotes, daily klines, and ticker profiles.
 * No broker interface.
 *
 * LICENSING / ATTRIBUTION: Massive usage and display-attribution requirements
 * depend on the provider plan and applicable Market Data Terms of Service.
 * Surface any required attribution in the Connections UI.
 */
export { MassiveFinancialDataProvider } from './adapter.ts'
export type { MassiveConfig } from './adapter.ts'
export { TtlCache } from './cache.ts'
export type { TtlCacheOptions } from './cache.ts'

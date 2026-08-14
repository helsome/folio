/**
 * Massive (Polygon.io) — minimal secondary market-data adapter.
 *
 * Proves the V4 router architecture (spec §13): a market-data-only
 * `FinancialDataProvider` serving US quotes, daily klines, and ticker profiles.
 * No broker interface.
 *
 * LICENSING / ATTRIBUTION: this adapter targets Massive's free "Stocks Basic"
 * tier for development only (end-of-day data, 5 calls/min, "Individual use").
 * A commercial ship requires a Massive Business plan, and display attribution
 * ("Powered by Polygon.io") may be required per the Market Data Terms of
 * Service. Surface this copy in the Connections UI — do not silently omit it.
 */
export { MassiveFinancialDataProvider } from './adapter.ts'
export type { MassiveConfig } from './adapter.ts'
export { TtlCache } from './cache.ts'
export type { TtlCacheOptions } from './cache.ts'

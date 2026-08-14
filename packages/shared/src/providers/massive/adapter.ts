import type {
  CapabilityId,
  FinancialDataProvider,
  Kline,
  Market,
  ProviderError,
  ProviderHealth,
  ProviderPermission,
  ProviderProvenance,
  ProviderResult,
  Quote,
  StaticInfo,
} from '@finagent/core'
import { isRecord } from '../../guards.ts'
import { TtlCache } from './cache.ts'

/**
 * Massive (Polygon.io) — minimal secondary market-data provider proving the V4
 * router architecture (spec §13). Market-data-only: no broker interface.
 *
 * - Coverage: `market.quote`, `market.kline`, `company.profile` for US stocks
 *   only (`markets(): [US]`), so the router never routes HK/CN/SG symbols here.
 * - Auth: BYOK API key resolved via a caller-provided config getter (the
 *   ConnectionStore holds the key; the Lead wires it). Current Massive docs use
 *   the `apiKey` query param; legacy Polygon used a `Bearer` header. We try the
 *   documented query-param form first and fall back to the Bearer header on a
 *   401, per the decision doc's risk note.
 * - Freshness: the free "Stocks Basic" tier is end-of-day, so every result is
 *   marked `delayed: true`. A small TTL cache respects the 5 calls/min cap.
 *
 * LICENSING: the free tier is "Individual use" only; a commercial ship requires
 * a Massive Business plan, and "Powered by Polygon.io" display attribution may
 * be required. See `./index.ts` and report to the Connections UI owner.
 */

const PROVIDER_ID = 'massive'
const PROVIDER_NAME = 'Massive (Polygon.io)'

const CAPABILITIES: readonly CapabilityId[] = [
  'market.quote',
  'market.kline',
  'company.profile',
]

const US_MARKET: Market = { id: 'US', name: 'United States' }

const DELAYED_PERMISSIONS: readonly ProviderPermission[] = [
  { id: 'realtime', label: 'Real-time data', granted: false },
]

const MASSIVE_HOST = 'https://api.massive.com'
const LEGACY_POLYGON_HOST = 'https://api.polygon.io'

type AuthScheme = 'query' | 'bearer'

/** Market suffixes longbridge uses that Massive cannot serve. */
const NON_US_MARKET_SUFFIXES: Record<string, true> = {
  HK: true,
  SH: true,
  SZ: true,
  SG: true,
  HAS: true,
}

const ABORTED: ProviderError = { code: 'ABORTED', message: 'Request aborted' }
const UNSUPPORTED: ProviderError = {
  code: 'UNSUPPORTED_CAPABILITY',
  message: 'Massive does not provide this data',
}
const CONFIG_MISSING: ProviderError = {
  code: 'CONFIG_MISSING',
  message: 'Add an API key to connect',
}

export interface MassiveConfig {
  /**
   * Resolves the BYOK API key from the ConnectionStore config. Must never log
   * or return the key to the renderer; this adapter only sends it to Massive.
   */
  getApiKey: () => Promise<string | undefined>
  /** Response cache override (tests inject a short-TTL cache). */
  cache?: TtlCache<ProviderResult<unknown>>
}

class ProviderHttpError extends Error {
  readonly providerError: ProviderError
  constructor(providerError: ProviderError) {
    super(providerError.message)
    this.name = 'ProviderHttpError'
    this.providerError = providerError
  }
}

export class MassiveFinancialDataProvider implements FinancialDataProvider {
  readonly kind = 'financial-data' as const
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  private readonly getApiKey: () => Promise<string | undefined>
  private readonly cache: TtlCache<ProviderResult<unknown>>

  constructor(config: MassiveConfig) {
    this.getApiKey = config.getApiKey
    this.cache = config.cache ?? new TtlCache<ProviderResult<unknown>>()
  }

  async status(): Promise<ProviderHealth> {
    const apiKey = (await this.getApiKey())?.trim()
    if (!apiKey) {
      return {
        status: 'not-connected',
        lastCheck: Date.now(),
        message: 'Add an API key to connect',
        permissions: [...DELAYED_PERMISSIONS],
      }
    }
    return {
      status: 'connected',
      lastCheck: Date.now(),
      message: 'Connected with your API key (free tier serves end-of-day data)',
      permissions: [...DELAYED_PERMISSIONS],
    }
  }

  capabilities(): CapabilityId[] {
    return [...CAPABILITIES]
  }

  markets(): Market[] {
    return [US_MARKET]
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (signal?.aborted) return { ok: false, error: ABORTED }
    if (!CAPABILITIES.includes(capabilityId)) return { ok: false, error: UNSUPPORTED }

    const symbol = readSymbol(input)
    if (symbol === undefined) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'A stock symbol is required' },
      }
    }

    const ticker = toTicker(symbol)
    if (!ticker.ok) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_CAPABILITY', message: 'Massive only provides US market data' },
      }
    }

    const apiKey = (await this.getApiKey())?.trim()
    if (!apiKey) return { ok: false, error: CONFIG_MISSING }

    const cacheKey = `${capabilityId}:${JSON.stringify(input)}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached as ProviderResult<T>

    try {
      const result = await this.fetchAndMap(
        capabilityId,
        ticker.ticker,
        symbol,
        apiKey,
        input,
        signal
      )
      if (result.ok) this.cache.set(cacheKey, result)
      return result as ProviderResult<T>
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { ok: false, error: ABORTED }
      }
      if (error instanceof ProviderHttpError) {
        return { ok: false, error: error.providerError }
      }
      return {
        ok: false,
        error: { code: 'UNKNOWN', message: 'Could not reach the data provider', retryable: true },
      }
    }
  }

  /** Drop cached responses (call after the BYOK key changes). */
  clearCache(): void {
    this.cache.clear()
  }

  private async fetchAndMap(
    capabilityId: CapabilityId,
    ticker: string,
    symbol: string,
    apiKey: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<unknown>> {
    switch (capabilityId) {
      case 'market.quote': {
        const path = `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`
        const payload = await getJson(path, apiKey, signal)
        const quote = mapQuote(symbol, payload)
        return { ok: true, data: quote, provenance: provenance(quote.timestamp) }
      }
      case 'market.kline': {
        const { count, timespan } = readKlineOptions(input)
        const { from, to } = klineRange(count)
        const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/${timespan}/${from}/${to}`
        const payload = await getJson(buildAggsUrl(path, count), apiKey, signal)
        const klines = mapKlines(symbol, payload)
        const marketTime = klines.length > 0 ? klines[klines.length - 1].timestamp : undefined
        return { ok: true, data: klines, provenance: provenance(marketTime) }
      }
      case 'company.profile': {
        const path = `/v3/reference/tickers/${encodeURIComponent(ticker)}`
        const payload = await getJson(path, apiKey, signal)
        const profile = mapProfile(symbol, payload)
        return { ok: true, data: profile, provenance: provenance() }
      }
      default:
        return { ok: false, error: UNSUPPORTED }
    }
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function getJson(path: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
  const response = await request(path, apiKey, signal)
  if (!response.ok) throw new ProviderHttpError(mapHttpStatus(response.status))
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderHttpError({
      code: 'PARSE_FAILURE',
      message: 'Unexpected response from the data provider',
    })
  }
}

/**
 * Try the documented `apiKey` query-param form first, then the legacy `Bearer`
 * header, across the canonical and legacy hosts. Returns the first non-401
 * response; propagates abort/network errors to the caller.
 */
async function request(path: string, apiKey: string, signal?: AbortSignal): Promise<Response> {
  const attempts: Array<{ base: string; scheme: AuthScheme }> = [
    { base: MASSIVE_HOST, scheme: 'query' },
    { base: MASSIVE_HOST, scheme: 'bearer' },
    { base: LEGACY_POLYGON_HOST, scheme: 'query' },
    { base: LEGACY_POLYGON_HOST, scheme: 'bearer' },
  ]

  let lastUnauthorized: Response | undefined
  let lastFailure: unknown

  for (const { base, scheme } of attempts) {
    const url = buildUrl(base, path, apiKey, scheme)
    try {
      const response = await fetch(url, {
        headers: scheme === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal,
      })
      if (response.status === 401) {
        lastUnauthorized = response
        continue
      }
      return response
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      lastFailure = error
    }
  }

  if (lastUnauthorized) return lastUnauthorized
  throw lastFailure instanceof Error ? lastFailure : new Error('Network error')
}

function buildUrl(base: string, path: string, apiKey: string, scheme: AuthScheme): string {
  const url = new URL(base + path)
  if (scheme === 'query') url.searchParams.set('apiKey', apiKey)
  return url.toString()
}

/** Builds the aggs URL with the non-auth query params (auth is added later). */
function buildAggsUrl(path: string, count: number): string {
  const url = new URL(MASSIVE_HOST + path)
  url.searchParams.set('adjusted', 'true')
  url.searchParams.set('sort', 'desc')
  url.searchParams.set('limit', String(count))
  return url.pathname + url.search
}

function mapHttpStatus(status: number): ProviderError {
  switch (status) {
    case 401:
      return { code: 'AUTH_EXPIRED', message: 'Your API key was rejected. Check the key and try again.' }
    case 403:
      return { code: 'AUTH_EXPIRED', message: 'Your plan does not include access to this data.' }
    case 404:
      return { code: 'NOT_FOUND', message: 'No data found for this symbol.' }
    case 429:
      return { code: 'RATE_LIMITED', message: 'Rate limit reached. Try again shortly.', retryable: true }
    default:
      return {
        code: 'UNKNOWN',
        message: 'The data provider returned an error.',
        retryable: status >= 500,
      }
  }
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function readSymbol(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const symbol = input.symbol
  return typeof symbol === 'string' && symbol.trim() !== '' ? symbol.trim().toUpperCase() : undefined
}

function toTicker(symbol: string): { ok: true; ticker: string } | { ok: false } {
  const match = /^(.+)\.([A-Z0-9]{1,5})$/.exec(symbol)
  if (!match) return { ok: true, ticker: symbol }
  const base = match[1]
  const suffix = match[2]
  if (suffix === 'US') return { ok: true, ticker: base }
  if (NON_US_MARKET_SUFFIXES[suffix]) return { ok: false }
  // e.g. BRK.B — a dot inside the ticker, not a market suffix.
  return { ok: true, ticker: symbol }
}

interface KlineOptions {
  count: number
  timespan: 'day' | 'week'
}

function readKlineOptions(input: unknown): KlineOptions {
  let count = 100
  let period = '1d'
  if (isRecord(input)) {
    const explicit = typeof input.count === 'number' ? input.count : input.limit
    if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
      count = Math.min(Math.floor(explicit), 1000)
    }
    if (typeof input.period === 'string') period = input.period
  }
  return { count, timespan: period === '1w' ? 'week' : 'day' }
}

function klineRange(count: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - count * 2 * 24 * 60 * 60 * 1000)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function toFinite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

interface SnapshotTicker {
  day?: { c?: unknown; h?: unknown; l?: unknown; o?: unknown; v?: unknown }
  min?: { t?: unknown }
  prevDay?: { c?: unknown }
  lastTrade?: { p?: unknown; t?: unknown }
  todaysChange?: unknown
  todaysChangePerc?: unknown
  updated?: unknown
}

function mapQuote(symbol: string, payload: unknown): Quote {
  const root = isRecord(payload) ? payload : {}
  const ticker = (isRecord(root.ticker) ? root.ticker : {}) as SnapshotTicker
  const day = ticker.day ?? {}
  const prevDay = ticker.prevDay ?? {}
  const lastTrade = ticker.lastTrade ?? {}

  const prevClose = toFinite(prevDay.c) ?? 0
  const lastPrice = toFinite(lastTrade.p) ?? toFinite(day.c) ?? prevClose
  const open = toFinite(day.o) ?? prevClose
  const high = toFinite(day.h) ?? prevClose
  const low = toFinite(day.l) ?? prevClose
  const volume = toFinite(day.v) ?? 0

  const change = toFinite(ticker.todaysChange) ?? lastPrice - prevClose
  const changePercent =
    toFinite(ticker.todaysChangePerc) ?? (prevClose === 0 ? 0 : (change / prevClose) * 100)

  const tradeTimeMs = toFinite(lastTrade.t)
  const minTimeMs = toFinite(ticker.min?.t)
  const updatedNs = toFinite(ticker.updated)
  const marketTimeMs =
    tradeTimeMs ?? minTimeMs ?? (updatedNs !== undefined ? updatedNs / 1_000_000 : undefined)
  const timestamp = marketTimeMs !== undefined ? Math.floor(marketTimeMs / 1000) : Math.floor(Date.now() / 1000)

  return { symbol, lastPrice, change, changePercent, volume, timestamp, high, low, open, prevClose }
}

function mapKlines(symbol: string, payload: unknown): Kline[] {
  const root = isRecord(payload) ? payload : {}
  const results = Array.isArray(root.results) ? root.results : []
  // Requested with sort=desc (most recent first); reverse to ascending.
  return results
    .filter(isRecord)
    .map((bar) => ({
      symbol,
      timestamp: Math.floor((toFinite(bar.t) ?? 0) / 1000),
      open: toFinite(bar.o) ?? 0,
      high: toFinite(bar.h) ?? 0,
      low: toFinite(bar.l) ?? 0,
      close: toFinite(bar.c) ?? 0,
      volume: toFinite(bar.v) ?? 0,
    }))
    .reverse()
}

/**
 * Maps ticker details into the core `StaticInfo` subset the free tier can
 * actually fill: `symbol`, `name`, `exchange` (primary_exchange), and
 * `currency` (currency_name). Left empty on purpose:
 *   - `description`/`sic_description`/`homepage_url`/`market` have no field on
 *     `StaticInfo` (core is not extended — see decision doc), so they are
 *     dropped rather than smuggled onto the neutral shape.
 *   - `lotSize`/`totalShares`/`circulatingShares`/`eps`/`epsTtm`/`bps`/
 *     `dividend` are not served by the ticker-details endpoint.
 */
function mapProfile(symbol: string, payload: unknown): StaticInfo {
  const root = isRecord(payload) ? payload : {}
  const results = isRecord(root.results) ? root.results : {}
  return {
    symbol,
    name: typeof results.name === 'string' ? results.name : '',
    exchange: typeof results.primary_exchange === 'string' ? results.primary_exchange : undefined,
    currency: typeof results.currency_name === 'string' ? results.currency_name : undefined,
  }
}

function provenance(marketTime?: number): ProviderProvenance {
  return {
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    fetchedAt: Date.now(),
    ...(marketTime !== undefined ? { marketTime } : {}),
    delayed: true,
    stale: false,
  }
}

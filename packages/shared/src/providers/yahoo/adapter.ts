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
import { bindProviderInput, stampProviderResult, type BoundProviderInput } from '../instrument.ts'
import { TtlCache } from '../massive/cache.ts'

/**
 * Yahoo Finance chart adapter. Market-data only: US quotes, daily/weekly
 * candles, and a thin company profile. No broker interface and no API key.
 *
 * The v8 chart host is unofficial. Every successful result is marked
 * `delayed: true`. A short TTL cache keeps repeated UI renders off the network.
 */

export const YAHOO_PROVIDER_ID = 'yahoo'
export const YAHOO_PROVIDER_NAME = 'Yahoo Finance'

const CAPABILITIES: readonly CapabilityId[] = ['market.quote', 'market.kline', 'company.profile']

const US_MARKET: Market = { id: 'US', name: 'United States' }

const DELAYED_PERMISSIONS: readonly ProviderPermission[] = [
  { id: 'realtime', label: 'Real-time data', granted: false },
  { id: 'delayed-us', label: 'Delayed US quotes', granted: true },
]

/** Browser-like UA. The chart host rejects empty or obvious bot agents. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const CHART_HOST = 'https://query1.finance.yahoo.com/v8/finance/chart/'

/** Longbridge market suffixes this adapter cannot serve. */
const NON_US_MARKET_SUFFIXES: Record<string, true> = {
  HK: true,
  SH: true,
  SZ: true,
  SG: true,
  HAS: true,
}

/**
 * Folio index symbols → Yahoo index tickers. `SPX` is the usual Longbridge
 * form; `^GSPC` is what the chart host expects.
 */
const INDEX_TICKERS: Record<string, string> = {
  SPX: '^GSPC',
  GSPC: '^GSPC',
  '^GSPC': '^GSPC',
  NDX: '^NDX',
  '^NDX': '^NDX',
  DJI: '^DJI',
  '^DJI': '^DJI',
  IXIC: '^IXIC',
  '^IXIC': '^IXIC',
  VIX: '^VIX',
  '^VIX': '^VIX',
  RUT: '^RUT',
  '^RUT': '^RUT',
}

const ABORTED: ProviderError = { code: 'ABORTED', message: 'Request aborted' }
const UNSUPPORTED: ProviderError = {
  code: 'UNSUPPORTED_CAPABILITY',
  message: 'Yahoo Finance does not provide this data',
}

export interface YahooConfig {
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

export class YahooChartFinancialDataProvider implements FinancialDataProvider {
  readonly kind = 'financial-data' as const
  readonly id = YAHOO_PROVIDER_ID
  readonly name = YAHOO_PROVIDER_NAME

  private readonly cache: TtlCache<ProviderResult<unknown>>

  constructor(config: YahooConfig = {}) {
    this.cache = config.cache ?? new TtlCache<ProviderResult<unknown>>({ ttlMs: 60_000 })
  }

  async status(): Promise<ProviderHealth> {
    return {
      status: 'connected',
      lastCheck: Date.now(),
      message: 'No API key required. Quotes are delayed and unofficial.',
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

    const bound = bindYahooInput(input)
    if (!bound.ok) return { ok: false, error: bound.error }
    const symbol = (bound.symbol || readSymbol(input) || '').trim().toUpperCase()
    if (!symbol) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'A stock symbol is required' } }
    }

    const ticker = toYahooTicker(symbol)
    if (!ticker.ok) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_CAPABILITY',
          message: 'Yahoo Finance in Folio only provides US market data',
        },
      }
    }

    if (capabilityId === 'market.kline') {
      const options = readKlineOptions(input)
      if (!options) {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_CAPABILITY',
            message: 'Yahoo Finance in Folio provides daily and weekly candles only',
          },
        }
      }
    }

    const cacheKey = `${capabilityId}:${bound.instrumentId ?? symbol}:${JSON.stringify(klineCacheInput(input))}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached as ProviderResult<T>

    try {
      const result = await this.fetchAndMap(capabilityId, ticker.ticker, symbol, input, signal)
      const stamped = stampProviderResult(result, bound.instrumentId)
      if (stamped.ok) this.cache.set(cacheKey, stamped)
      return stamped as ProviderResult<T>
    } catch (error) {
      if (
        signal?.aborted &&
        signal.reason instanceof DOMException &&
        signal.reason.name === 'TimeoutError'
      ) {
        return {
          ok: false,
          error: { code: 'TIMEOUT', message: 'Yahoo Finance timed out.', retryable: true },
        }
      }
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { ok: false, error: ABORTED }
      }
      if (error instanceof ProviderHttpError) return { ok: false, error: error.providerError }
      return {
        ok: false,
        error: { code: 'UNKNOWN', message: 'Could not reach Yahoo Finance', retryable: true },
      }
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  private async fetchAndMap(
    capabilityId: CapabilityId,
    ticker: string,
    symbol: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<unknown>> {
    switch (capabilityId) {
      case 'market.quote': {
        const chart = await fetchChart(ticker, '5d', '1d', signal)
        const quote = mapQuote(symbol, chart)
        return { ok: true, data: quote, provenance: provenance(quote.timestamp * 1000) }
      }
      case 'market.kline': {
        const options = readKlineOptions(input)
        if (!options) return { ok: false, error: UNSUPPORTED }
        const range = chartRange(options.count, options.interval)
        const chart = await fetchChart(ticker, range, options.interval, signal)
        const klines = mapKlines(symbol, chart).slice(-options.count)
        const marketTime = klines.length > 0 ? klines[klines.length - 1].timestamp * 1000 : undefined
        return { ok: true, data: klines, provenance: provenance(marketTime) }
      }
      case 'company.profile': {
        const chart = await fetchChart(ticker, '5d', '1d', signal)
        return { ok: true, data: mapProfile(symbol, chart), provenance: provenance() }
      }
      default:
        return { ok: false, error: UNSUPPORTED }
    }
  }
}

function bindYahooInput(input: unknown): BoundProviderInput {
  const direct = bindProviderInput(input, YAHOO_PROVIDER_ID)
  if (direct.ok && direct.symbol) return direct
  // Catalogs saved before Yahoo aliases existed still carry Massive (bare
  // ticker) and Longbridge (`AAPL.US`) symbols. Both normalize below.
  const massive = bindProviderInput(input, 'massive')
  if (massive.ok && massive.symbol) return massive
  const longbridge = bindProviderInput(input, 'longbridge')
  if (longbridge.ok && longbridge.symbol) return longbridge
  return direct
}

interface ChartSeries {
  open: Array<number | null>
  high: Array<number | null>
  low: Array<number | null>
  close: Array<number | null>
  volume: Array<number | null>
}

interface ChartResult {
  meta: Record<string, unknown>
  timestamp: number[]
  quote: ChartSeries
}

async function fetchChart(
  ticker: string,
  range: string,
  interval: '1d' | '1wk',
  signal?: AbortSignal
): Promise<ChartResult> {
  const url = `${CHART_HOST}${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=${interval}&includePrePost=false`
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal,
    })
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new ProviderHttpError({
      code: 'UNKNOWN',
      message: 'Could not reach Yahoo Finance',
      retryable: true,
    })
  }

  if (!response.ok) throw new ProviderHttpError(mapHttpStatus(response.status))

  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ProviderHttpError({
      code: 'PARSE_FAILURE',
      message: 'Unexpected response from Yahoo Finance',
    })
  }
  return parseChart(body)
}

function parseChart(body: unknown): ChartResult {
  const root = isRecord(body) ? body : {}
  const chart = isRecord(root.chart) ? root.chart : {}
  const results = Array.isArray(chart.result) ? chart.result : []
  const first = results.find(isRecord)
  if (!first) {
    throw new ProviderHttpError({
      code: 'NOT_FOUND',
      message: 'No data found for this symbol.',
    })
  }
  const meta = isRecord(first.meta) ? first.meta : {}
  const timestamp = Array.isArray(first.timestamp)
    ? first.timestamp.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : []
  const indicators = isRecord(first.indicators) ? first.indicators : {}
  const quotes = Array.isArray(indicators.quote) ? indicators.quote : []
  const quote = quotes.find(isRecord) ?? {}
  return {
    meta,
    timestamp,
    quote: {
      open: numberSeries(quote.open),
      high: numberSeries(quote.high),
      low: numberSeries(quote.low),
      close: numberSeries(quote.close),
      volume: numberSeries(quote.volume),
    },
  }
}

function numberSeries(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
}

function mapHttpStatus(status: number): ProviderError {
  switch (status) {
    case 404:
      return { code: 'NOT_FOUND', message: 'No data found for this symbol.' }
    case 429:
      return {
        code: 'RATE_LIMITED',
        message: 'Yahoo Finance rate limit reached. Try again shortly.',
        retryable: true,
      }
    default:
      return {
        code: 'UNKNOWN',
        message: 'Yahoo Finance returned an error.',
        retryable: status >= 500,
      }
  }
}

function readSymbol(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const symbol = input.symbol
  return typeof symbol === 'string' && symbol.trim() !== '' ? symbol.trim().toUpperCase() : undefined
}

function toYahooTicker(symbol: string): { ok: true; ticker: string } | { ok: false } {
  const match = /^(.+)\.([A-Z0-9]{2,5})$/.exec(symbol)
  let base = symbol
  if (match) {
    const suffix = match[2]
    if (NON_US_MARKET_SUFFIXES[suffix]) return { ok: false }
    if (suffix === 'US') base = match[1]
  }
  const indexed = INDEX_TICKERS[base]
  const ticker = indexed ?? (base.startsWith('^') ? base : base.replace(/\./g, '-'))
  if (!/^[\^A-Z0-9-]{1,32}$/.test(ticker)) return { ok: false }
  return { ok: true, ticker }
}

interface KlineOptions {
  count: number
  interval: '1d' | '1wk'
}

function readKlineOptions(input: unknown): KlineOptions | undefined {
  let count = 100
  let period = '1d'
  if (isRecord(input)) {
    const explicit = typeof input.count === 'number' ? input.count : input.limit
    if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
      count = Math.min(Math.floor(explicit), 1000)
    }
    if (typeof input.period === 'string' && input.period.trim() !== '') period = input.period
  }
  if (period !== '1d' && period !== '1w') return undefined
  return { count, interval: period === '1w' ? '1wk' : '1d' }
}

function klineCacheInput(input: unknown): { period: string; count: number } {
  const options = readKlineOptions(input)
  return { period: options?.interval ?? 'na', count: options?.count ?? 0 }
}

function chartRange(count: number, interval: '1d' | '1wk'): string {
  if (interval === '1wk') {
    if (count > 260) return '10y'
    if (count > 104) return '5y'
    return '2y'
  }
  if (count > 900) return '10y'
  if (count > 250) return '5y'
  if (count > 120) return '1y'
  return '6mo'
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function lastFinite(series: Array<number | null>): number | undefined {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]
    if (typeof value === 'number') return value
  }
  return undefined
}

function previousFinite(series: Array<number | null>, latest: number | undefined): number | undefined {
  let seenLatest = latest === undefined
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]
    if (typeof value !== 'number') continue
    if (!seenLatest && value === latest) {
      seenLatest = true
      continue
    }
    if (seenLatest) return value
  }
  return undefined
}

function mapQuote(symbol: string, chart: ChartResult): Quote {
  const meta = chart.meta
  const closes = chart.quote.close
  const lastClose = lastFinite(closes)
  const lastPrice = finite(meta.regularMarketPrice) ?? lastClose
  if (lastPrice === undefined) {
    throw new ProviderHttpError({ code: 'NOT_FOUND', message: 'No data found for this symbol.' })
  }
  const prevClose =
    finite(meta.previousClose) ??
    finite(meta.chartPreviousClose) ??
    previousFinite(closes, lastClose) ??
    lastPrice
  const change = lastPrice - prevClose
  const changePercent = prevClose === 0 ? 0 : (change / prevClose) * 100
  const open = finite(meta.regularMarketOpen) ?? lastFinite(chart.quote.open) ?? lastPrice
  const high = finite(meta.regularMarketDayHigh) ?? lastFinite(chart.quote.high) ?? lastPrice
  const low = finite(meta.regularMarketDayLow) ?? lastFinite(chart.quote.low) ?? lastPrice
  const volume = finite(meta.regularMarketVolume) ?? lastFinite(chart.quote.volume) ?? 0
  const rawTime = finite(meta.regularMarketTime)
  const timestamp =
    rawTime === undefined
      ? Math.floor(Date.now() / 1000)
      : rawTime > 1e12
        ? Math.floor(rawTime / 1000)
        : Math.floor(rawTime)

  return { symbol, lastPrice, change, changePercent, volume, timestamp, high, low, open, prevClose }
}

function mapKlines(symbol: string, chart: ChartResult): Kline[] {
  const { quote, timestamp } = chart
  const count = Math.max(timestamp.length, quote.open.length, quote.close.length)
  const bars: Kline[] = []
  for (let index = 0; index < count; index += 1) {
    const time = timestamp[index]
    const open = quote.open[index]
    const high = quote.high[index]
    const low = quote.low[index]
    const close = quote.close[index]
    if (
      typeof time !== 'number' ||
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number'
    ) {
      continue
    }
    const volume = quote.volume[index]
    bars.push({
      symbol,
      timestamp: time > 1e12 ? Math.floor(time / 1000) : Math.floor(time),
      open,
      high,
      low,
      close,
      volume: typeof volume === 'number' ? volume : 0,
    })
  }
  bars.sort((left, right) => left.timestamp - right.timestamp)
  return bars
}

function mapProfile(symbol: string, chart: ChartResult): StaticInfo {
  const meta = chart.meta
  const longName = typeof meta.longName === 'string' ? meta.longName : ''
  const shortName = typeof meta.shortName === 'string' ? meta.shortName : ''
  const exchange =
    typeof meta.fullExchangeName === 'string'
      ? meta.fullExchangeName
      : typeof meta.exchangeName === 'string'
        ? meta.exchangeName
        : undefined
  const currency = typeof meta.currency === 'string' ? meta.currency : undefined
  return {
    symbol,
    name: longName || shortName,
    ...(exchange ? { exchange } : {}),
    ...(currency ? { currency } : {}),
  }
}

function provenance(marketTime?: number): ProviderProvenance {
  return {
    providerId: YAHOO_PROVIDER_ID,
    providerName: YAHOO_PROVIDER_NAME,
    fetchedAt: Date.now(),
    ...(marketTime !== undefined ? { marketTime } : {}),
    delayed: true,
    stale: false,
  }
}

import { afterEach, describe, expect, it } from 'bun:test'
import type { Kline, ProviderResult, Quote, StaticInfo } from '@finagent/core'
import { MassiveFinancialDataProvider } from './adapter.ts'
import { TtlCache } from './cache.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type FetchResponder = (url: string, init?: RequestInit) => Response

function installFetch(responder: FetchResponder): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return responder(url, init)
  }) as typeof fetch
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeProvider(
  key: string | undefined,
  cache?: TtlCache<ProviderResult<unknown>>
): MassiveFinancialDataProvider {
  return new MassiveFinancialDataProvider({ getApiKey: async () => key, cache })
}

function snapshotPayload() {
  return {
    status: 'OK',
    ticker: {
      day: { c: 120.4229, h: 121.85, l: 119.9, o: 121.09, v: 42527868 },
      min: { c: 120.4229, t: 1699559040000 },
      prevDay: { c: 120.44, h: 120.69, l: 119.32, o: 119.5, v: 45223491 },
      lastTrade: { p: 120.42, s: 100, t: 1699559040000 },
      todaysChange: -0.0171,
      todaysChangePerc: -0.014,
      updated: 1699559040000000000,
    },
  }
}

describe('MassiveFinancialDataProvider', () => {
  it('declares its identity, market, and capabilities', () => {
    const provider = makeProvider('key')
    expect(provider.id).toBe('massive')
    expect(provider.name).toBe('Massive (Polygon.io)')
    expect(provider.kind).toBe('financial-data')
    expect(provider.markets()).toEqual([{ id: 'US', name: 'United States' }])
    expect(provider.capabilities()).toEqual(['market.quote', 'market.kline', 'company.profile'])
  })

  it('maps a snapshot quote (previous close + last trade) via query-param auth', async () => {
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = makeProvider('testkey')
    const result = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      symbol: 'AAPL.US',
      lastPrice: 120.42,
      change: -0.0171,
      changePercent: -0.014,
      volume: 42527868,
      timestamp: 1699559040,
      high: 121.85,
      low: 119.9,
      open: 121.09,
      prevClose: 120.44,
    })
    expect(result.provenance.providerId).toBe('massive')
    expect(result.provenance.providerName).toBe('Massive (Polygon.io)')
    expect(result.provenance.delayed).toBe(true)
    expect(result.provenance.stale).toBe(false)
    expect(result.provenance.marketTime).toBe(1699559040)

    // First attempt uses the documented apiKey query param on the canonical host.
    expect(calls[0].url).toContain('https://api.massive.com')
    expect(calls[0].url).toContain('apiKey=testkey')
    expect(calls[0].url).toContain('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL')
  })

  it('falls back to the previous close when the free tier omits OHLC', async () => {
    installFetch(() =>
      jsonResponse({
        ticker: {
          day: { c: 120.42, v: 1000 },
          prevDay: { c: 120.44 },
          lastTrade: { p: 120.42, t: 1699559040000 },
        },
      })
    )
    const provider = makeProvider('key')
    const result = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.open).toBe(120.44)
    expect(result.data.high).toBe(120.44)
    expect(result.data.low).toBe(120.44)
    expect(result.data.prevClose).toBe(120.44)
    expect(result.data.lastPrice).toBe(120.42)
    expect(result.data.change).toBeCloseTo(-0.02, 5)
  })

  it('maps daily aggregates to ascending Kline[]', async () => {
    installFetch(() =>
      jsonResponse({
        status: 'OK',
        ticker: 'AAPL',
        results: [
          { c: 74.3575, h: 75.145, l: 74.125, o: 74.2875, t: 1578027600000, v: 146535512 },
          { c: 75.0875, h: 75.15, l: 73.7975, o: 74.06, t: 1577941200000, v: 135647456 },
        ],
      })
    )
    const provider = makeProvider('key')
    const result = await provider.execute<Kline[]>('market.kline', { symbol: 'AAPL.US', limit: 100 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(2)
    expect(result.data[0].symbol).toBe('AAPL.US')
    expect(result.data[0].timestamp).toBe(1577941200)
    expect(result.data[0].close).toBe(75.0875)
    expect(result.data[1].timestamp).toBe(1578027600)
    expect(result.data[1].open).toBe(74.2875)
    expect(result.data[1].close).toBe(74.3575)
    expect(result.data[1].volume).toBe(146535512)
  })

  it('maps ticker details to the StaticInfo subset', async () => {
    installFetch(() =>
      jsonResponse({
        count: 1,
        results: {
          ticker: 'AAPL',
          name: 'Apple Inc.',
          market: 'stocks',
          locale: 'us',
          primary_exchange: 'XNAS',
          currency_name: 'usd',
          sic_description: 'Electronic Computers',
          homepage_url: 'https://www.apple.com',
        },
      })
    )
    const provider = makeProvider('key')
    const result = await provider.execute<StaticInfo>('company.profile', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      symbol: 'AAPL.US',
      name: 'Apple Inc.',
      exchange: 'XNAS',
      currency: 'usd',
    })
  })

  it('returns CONFIG_MISSING when no API key is configured', async () => {
    const provider = makeProvider(undefined)
    const result = await provider.execute('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONFIG_MISSING')
    expect(result.error.message).toBe('Add an API key to connect')
  })

  it('returns UNSUPPORTED_CAPABILITY for undeclared capabilities', async () => {
    const provider = makeProvider('key')
    const result = await provider.execute('market.intraday', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNSUPPORTED_CAPABILITY')
  })

  it('serves repeated requests from cache (fetch called once)', async () => {
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = makeProvider('key')

    const first = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
    const second = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('refetches after the cache TTL expires', async () => {
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = makeProvider('key', new TtlCache<ProviderResult<unknown>>({ ttlMs: 10 }))

    await provider.execute('market.quote', { symbol: 'AAPL.US' })
    await Bun.sleep(20)
    await provider.execute('market.quote', { symbol: 'AAPL.US' })

    expect(calls).toHaveLength(2)
  })

  it('returns ABORTED when the signal is already aborted', async () => {
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = makeProvider('key')
    const controller = new AbortController()
    controller.abort()

    const result = await provider.execute('market.quote', { symbol: 'AAPL.US' }, controller.signal)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ABORTED')
    expect(calls).toHaveLength(0)
  })

  it('falls back to Bearer auth when the query-param form 401s', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      return url.includes('apiKey=') ? jsonResponse({ status: 'NOT_AUTHORIZED' }, 401) : jsonResponse(snapshotPayload())
    }) as typeof fetch

    const provider = makeProvider('key')
    const result = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('apiKey=key')
    expect(calls[0].init?.headers).toBeUndefined()
    expect(calls[1].init?.headers).toEqual({ Authorization: 'Bearer key' })
  })

  it('reports not-connected without a key and connected with one', async () => {
    const withoutKey = await makeProvider(undefined).status()
    expect(withoutKey.status).toBe('not-connected')
    expect(withoutKey.message).toBe('Add an API key to connect')
    expect(withoutKey.permissions).toEqual([
      { id: 'realtime', label: 'Real-time data', granted: false },
    ])

    const connected = await makeProvider('key').status()
    expect(connected.status).toBe('connected')
    expect(connected.permissions).toEqual([
      { id: 'realtime', label: 'Real-time data', granted: false },
    ])
  })
})

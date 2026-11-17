import { afterEach, describe, expect, it } from 'bun:test'
import type { FinancialReport, Kline, ProviderResult, Quote, StaticInfo } from '@finagent/core'
import { DEFAULT_INSTRUMENT_CATALOG, InstrumentResolver } from '@finagent/core'
import { MarketDataService } from '../../agent/market-data-service.ts'
import { HeatmapService, parseHeatmapSource } from '../../heatmap/service.ts'
import { ProviderRouter } from '../router.ts'
import { createRouterFetchers } from '../router-fetchers.ts'
import { MassiveFinancialDataProvider } from './adapter.ts'
import { TtlCache } from './cache.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type FetchResponder = (url: string, init?: RequestInit) => Response | Promise<Response>

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function quoteResponse(price: number): Response {
  const payload = snapshotPayload()
  payload.ticker.lastTrade.p = price
  return jsonResponse(payload)
}

function expectPrice(result: ProviderResult<Quote>, price: number): void {
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.data.lastPrice).toBe(price)
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
    expect(provider.capabilities()).toEqual(['market.quote', 'market.kline', 'company.profile', 'company.financials'])
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
    // Quote.timestamp is epoch SECONDS; provenance.marketTime is epoch MS
    // (issue #179) — the magnitude assertion pins the unit conversion.
    expect(result.provenance.marketTime).toBe(1699559040_000)
    expect(result.provenance.marketTime! > 1e12).toBe(true)

    // First attempt uses the documented apiKey query param on the canonical host.
    expect(calls[0].url).toContain('https://api.massive.com')
    expect(calls[0].url).toContain('apiKey=testkey')
    expect(calls[0].url).toContain('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL')
  })

  it('converts a canonical instrument to the Massive ticker and stamps instrumentId', async () => {
    const apple = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = makeProvider('testkey')
    const result = await provider.execute<Quote>('market.quote', { instrument: apple })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.instrumentId).toBe('XNAS:AAPL')
    expect(result.provenance.instrumentId).toBe('XNAS:AAPL')
    expect(calls[0].url).toContain('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL')
    expect(calls[0].url).not.toContain('AAPL.US')
  })

  it('uses an HTTPS endpoint override without exposing the API key in provider state', async () => {
    const calls = installFetch(() => jsonResponse(snapshotPayload()))
    const provider = new MassiveFinancialDataProvider({
      getApiKey: async () => 'canary-secret-123',
      getEndpoint: async () => 'https://proxy.example.test/',
    })

    const result = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
    expect(result.ok).toBe(true)
    expect(calls[0].url).toStartWith('https://proxy.example.test/')
    expect(JSON.stringify(await provider.status())).not.toContain('canary-secret-123')
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
    // Kline timestamps are epoch SECONDS; provenance.marketTime is epoch MS
    // (issue #179). The last (most recent) bar is the market time.
    expect(result.provenance.marketTime).toBe(1578027600_000)
    expect(result.provenance.marketTime! > 1e12).toBe(true)
  })

  it('sizes the weekly window by weeks so the requested bars fit', async () => {
    const calls = installFetch(() =>
      jsonResponse({ status: 'OK', ticker: 'AAPL', results: [] })
    )
    const provider = makeProvider('key')
    await provider.execute<Kline[]>('market.kline', {
      symbol: 'AAPL.US',
      period: '1w',
      limit: 300,
    })

    // One bar per calendar week: 300 weekly bars need roughly 300 * 7 = 2100 days.
    const range = /\/range\/1\/week\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/.exec(calls[0].url)
    expect(range).not.toBeNull()
    if (!range) return
    const days = Math.round((Date.parse(range[2]) - Date.parse(range[1])) / 86_400_000)
    expect(days).toBeGreaterThanOrEqual(300 * 7)
  })

  it('keeps the daily window at two days per requested bar', async () => {
    const calls = installFetch(() =>
      jsonResponse({ status: 'OK', ticker: 'AAPL', results: [] })
    )
    const provider = makeProvider('key')
    await provider.execute<Kline[]>('market.kline', {
      symbol: 'AAPL.US',
      period: '1d',
      limit: 100,
    })

    const range = /\/range\/1\/day\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/.exec(calls[0].url)
    expect(range).not.toBeNull()
    if (!range) return
    const days = Math.round((Date.parse(range[2]) - Date.parse(range[1])) / 86_400_000)
    expect(days).toBe(200)
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
          sic_code: '3571',
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
      industry: { name: 'Electronic Computers', classification: 'SIC', code: '3571' },
    })
  })

  it.each([
    ['absent fields', {}],
    ['code without a description', { sic_code: '3571' }],
    ['blank description', { sic_description: '   ', sic_code: '3571' }],
    ['null description', { sic_description: null, sic_code: '3571' }],
    ['non-string description', { sic_description: 42, sic_code: '3571' }],
  ] satisfies Array<[string, Record<string, unknown>]>)('keeps industry unknown for %s', async (_label, fields) => {
    installFetch(() => jsonResponse({ results: { name: 'Apple Inc.', ...fields } }))
    const result = await makeProvider('key').execute<StaticInfo>('company.profile', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.industry).toBeUndefined()
  })

  it('trims industry labels and preserves leading zeros in SIC codes', async () => {
    installFetch(() => jsonResponse({ results: {
      sic_description: '  Wheat  ', sic_code: ' 0111 ',
    } }))
    const result = await makeProvider('key').execute<StaticInfo>('company.profile', { symbol: 'TEST.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.industry).toEqual({ name: 'Wheat', classification: 'SIC', code: '0111' })
  })

  it.each([undefined, null, 3571, '', '357', '35x1'])('omits an unavailable or malformed SIC code (%s)', async (code) => {
    installFetch(() => jsonResponse({ results: {
      sic_description: 'Electronic Computers', sic_code: code,
    } }))
    const result = await makeProvider('key').execute<StaticInfo>('company.profile', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.industry).toEqual({ name: 'Electronic Computers', classification: 'SIC' })
  })

  it('carries industry through canonical routing and the shared reference cache without extra requests', async () => {
    const calls = installFetch(() => jsonResponse({ results: {
      name: 'Apple Inc.', sic_description: 'Electronic Computers', sic_code: '3571',
    } }))
    const router = new ProviderRouter()
    router.register(makeProvider('key'))
    router.setRouting({ primary: 'massive' })
    const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG)
    const service = new MarketDataService({ fetchers: createRouterFetchers(router, {
      resolve: (query) => resolver.resolve(query),
    }) })

    const [first, concurrent] = await Promise.all([
      service.getStaticInfo('AAPL.US'), service.getStaticInfo('AAPL.US'),
    ])
    const cached = await service.getStaticInfo('AAPL.US')

    expect(first.instrumentId).toBe('XNAS:AAPL')
    expect(first.industry).toEqual({ name: 'Electronic Computers', classification: 'SIC', code: '3571' })
    expect(concurrent).toEqual(first)
    expect(cached).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0].url).pathname).toBe('/v3/reference/tickers/AAPL')
  })

  it('loads heatmap through the real router/cache while keeping portfolio valuations out of HTTP', async () => {
    const calls = installFetch((url) => jsonResponse(url.includes('/v3/reference/')
      ? { results: { name: 'Apple Inc.', sic_description: 'Electronic Computers', sic_code: '3571' } }
      : snapshotPayload()))
    const router = new ProviderRouter()
    router.register(makeProvider('fixture-key'))
    router.setRouting({ primary: 'massive' })
    const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG)
    const resolve = (query: string) => resolver.resolve(query)
    const market = new MarketDataService({ fetchers: createRouterFetchers(router, { resolve }) })
    await market.getQuote('AAPL.US')
    await market.getStaticInfo('AAPL.US')
    const result = await new HeatmapService({ marketData: market, resolve }).load(parseHeatmapSource({
      schemaVersion: 1, kind: 'portfolio', id: 'local-account', revision: 'v1', capturedAt: Date.now(),
      baseCurrency: 'USD', valuationCurrency: 'USD',
      entries: [{ symbol: 'AAPL.US', holding: { quantity: 17, marketValueBase: 2047, currency: 'USD' } }],
    }))
    expect(result.tiles[0]?.instrument.instrumentId).toBe('XNAS:AAPL')
    expect(result.tiles[0]?.industry?.code).toBe('3571')
    expect(result.tiles[0]?.valueBase).toBe(2047)
    expect(result.tiles[0]?.weight).toBe(1)
    expect(result.tiles[0]?.state).toBe('stale')
    expect(result.tiles[0]?.provenance?.providerId).toBe('massive')
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect([...new URL(call.url).searchParams.keys()]).toEqual(['apiKey'])
      expect(call.init?.body).toBeUndefined()
      expect(call.url).not.toContain('2047')
      expect(call.url).not.toContain('local-account')
    }
    expect('entries' in result.source).toBe(false)
  })

  it('loads three current financial statement endpoints and preserves period and filing dates', async () => {
    const rows: Record<string, Record<string, unknown>> = {
      'income-statements': { revenue: 94036000000, operating_income: 28202000000 },
      'balance-sheets': { total_assets: 331495000000, total_liabilities: 265665000000 },
      'cash-flow-statements': { net_cash_from_operating_activities: 27867000000 },
    }
    const calls = installFetch((url) => {
      const kind = Object.keys(rows).find((name) => url.includes(`/${name}?`))!
      return jsonResponse({ status: 'OK', results: [{
        tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025,
        fiscal_quarter: 3, period_end: '2025-06-28', filing_date: '2025-08-01',
        ...rows[kind],
      }] })
    })
    const provider = makeProvider('key')
    const result = await provider.execute<FinancialReport>('company.financials', {
      symbol: 'AAPL.US', kind: 'ALL', report: 'qf',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/stocks/financials/v1/income-statements',
      '/stocks/financials/v1/balance-sheets',
      '/stocks/financials/v1/cash-flow-statements',
    ])
    for (const call of calls) {
      const url = new URL(call.url)
      expect(url.searchParams.get('tickers')).toBe('AAPL')
      expect(url.searchParams.get('timeframe')).toBe('quarterly')
      expect(url.searchParams.get('sort')).toBe('period_end.desc')
    }
    expect(result.data.report).toBe('qf')
    expect(result.data.statements.IS?.indicators[0].accounts.find((item) => item.field === 'OperatingRevenue')?.values).toEqual([{
      fpEnd: 1751068800, filedAt: 1754006400, period: 'Q3 2025', year: 2025, value: 94036000000,
    }])
    expect(result.data.statements.BS?.indicators[0].accounts.map((item) => item.field))
      .toEqual(['TotalAssets', 'TotalLiability'])
    expect(result.data.statements.CF?.indicators[0].accounts[0].field).toBe('NetOperateCashFlow')
    // These endpoints omit reporting currency. Trading currency must not be substituted.
    expect(result.data.statements.IS?.indicators[0].currency).toBeUndefined()
    expect(result.provenance.marketTime).toBe(1751068800_000)
  })

  it('uses the annual filter and keeps only the requested statement', async () => {
    const calls = installFetch(() => jsonResponse({ status: 'OK', results: [
      { tickers: ['AAPL'], timeframe: 'annual', fiscal_year: 2024, period_end: '2024-12-31', total_assets: 100 },
      { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 1, period_end: '2025-03-31', total_assets: 200 },
    ] }))
    const result = await makeProvider('key').execute<FinancialReport>('company.financials', {
      symbol: 'AAPL.US', kind: 'BS', report: 'af',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0].url).searchParams.get('timeframe')).toBe('annual')
    expect(result.data.statements.BS?.indicators[0].accounts[0].values).toEqual([{
      fpEnd: 1735603200, period: 'FY 2024', year: 2024, value: 100,
    }])
    expect(result.data.statements.IS).toBeUndefined()
  })

  it('ignores another ticker and picks the latest filing for the same fiscal period', async () => {
    installFetch(() => jsonResponse({ status: 'OK', results: [
      { tickers: ['MSFT'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 3,
        period_end: '2025-06-28', filing_date: '2025-08-10', revenue: 900 },
      { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 3,
        period_end: '2025-06-28', filing_date: '2025-08-01', revenue: 100 },
      { tickers: ['AAPL'], timeframe: 'quarterly', fiscal_year: 2025, fiscal_quarter: 3,
        period_end: '2025-06-28', filing_date: '2025-08-11', revenue: 110 },
    ] }))
    const result = await makeProvider('key').execute<FinancialReport>('company.financials', {
      symbol: 'AAPL.US', kind: 'IS', report: 'qf',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.statements.IS?.indicators[0].accounts[0].values).toEqual([{
      fpEnd: 1751068800, filedAt: 1754870400, period: 'Q3 2025', year: 2025, value: 110,
    }])
  })

  it('reports financial entitlement errors and unsupported period semantics', async () => {
    const calls = installFetch(() => jsonResponse({ status: 'NOT_AUTHORIZED' }))
    const provider = makeProvider('key')
    const unsupported = await provider.execute('company.financials', { symbol: 'AAPL.US', report: 'cumul' })
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.error.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(calls).toHaveLength(0)
    const denied = await provider.execute('company.financials', { symbol: 'AAPL.US', report: 'qf' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('ACCESS_DENIED')
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

  for (const firstResponse of ['old', 'new'] as const) {
    it('keeps the cleared cache fresh when the ' + firstResponse + ' response finishes first', async () => {
      const oldResponse = deferred<Response>()
      const oldFetchStarted = deferred<void>()
      let endpoint = 'https://old.example.test'
      let apiKey = 'old-fake-key'
      const calls = installFetch((url) => {
        if (new URL(url).origin === 'https://old.example.test') {
          oldFetchStarted.resolve(undefined)
          return oldResponse.promise
        }
        return quoteResponse(200)
      })
      const provider = new MassiveFinancialDataProvider({
        getApiKey: async () => apiKey,
        getEndpoint: async () => endpoint,
      })
      const pending = provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
      await oldFetchStarted.promise

      apiKey = 'new-fake-key'
      endpoint = 'https://new.example.test'
      provider.clearCache()
      let previous: ProviderResult<Quote>
      let current: ProviderResult<Quote>
      if (firstResponse === 'old') {
        oldResponse.resolve(quoteResponse(100))
        previous = await pending
        current = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
      } else {
        current = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
        oldResponse.resolve(quoteResponse(100))
        previous = await pending
      }
      const cached = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

      expectPrice(previous, 100)
      expectPrice(current, 200)
      expectPrice(cached, 200)
      expect(calls.map(({ url }) => new URL(url).origin)).toEqual([
        'https://old.example.test', 'https://new.example.test',
      ])
    })
  }

  for (const configRead of ['API key', 'endpoint'] as const) {
    it('invalidates requests already awaiting their ' + configRead, async () => {
      const configStarted = deferred<void>()
      const oldConfig = deferred<string>()
      let firstKey = true
      let firstEndpoint = true
      const calls = installFetch((url) => {
        const parsed = new URL(url)
        const old = parsed.origin === 'https://old.example.test'
          || parsed.searchParams.get('apiKey') === 'old-fake-key'
        return quoteResponse(old ? 100 : 200)
      })
      const provider = new MassiveFinancialDataProvider({
        getApiKey: async () => {
          if (configRead === 'API key' && firstKey) {
            firstKey = false
            configStarted.resolve(undefined)
            return oldConfig.promise
          }
          return 'new-fake-key'
        },
        getEndpoint: async () => {
          if (configRead === 'endpoint' && firstEndpoint) {
            firstEndpoint = false
            configStarted.resolve(undefined)
            return oldConfig.promise
          }
          return 'https://new.example.test'
        },
      })
      const pending = provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
      await configStarted.promise
      provider.clearCache()
      oldConfig.resolve(configRead === 'API key' ? 'old-fake-key' : 'https://old.example.test')
      const previous = await pending
      const current = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
      const cached = await provider.execute<Quote>('market.quote', { symbol: 'AAPL.US' })

      expectPrice(previous, 100)
      expectPrice(current, 200)
      expectPrice(cached, 200)
      expect(calls).toHaveLength(2)
    })
  }

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

  it.each([
    [401, 'AUTH_EXPIRED'],
    [403, 'ACCESS_DENIED'],
    [429, 'RATE_LIMITED'],
  ] as const)('maps HTTP %s to the stable diagnostic code %s', async (status, code) => {
    installFetch(() => jsonResponse({}, status))
    const result = await makeProvider('canary-secret-123').execute('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(code)
    expect(result.error.message).not.toContain('canary-secret-123')
  })

  it('distinguishes a timed-out production request from a user abort', async () => {
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })) as typeof fetch
    const result = await makeProvider('key').execute(
      'market.quote',
      { symbol: 'AAPL.US' },
      AbortSignal.timeout(1)
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TIMEOUT')
  })

  it('does not claim a configured key is connected before a production-path test', async () => {
    const withoutKey = await makeProvider(undefined).status()
    expect(withoutKey.status).toBe('not-connected')
    expect(withoutKey.message).toBe('Add an API key to connect')
    expect(withoutKey.permissions).toEqual([
      { id: 'realtime', label: 'Real-time data', granted: false },
    ])

    const configured = await makeProvider('key').status()
    expect(configured.status).toBe('not-connected')
    expect(configured.diagnostic).toBe('degraded')
    expect(configured.permissions).toEqual([
      { id: 'realtime', label: 'Real-time data', granted: false },
    ])
  })
})

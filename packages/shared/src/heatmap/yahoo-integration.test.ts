import { afterEach, describe, expect, it } from 'bun:test'
import { DEFAULT_INSTRUMENT_CATALOG, InstrumentResolver } from '@finagent/core'
import type { Quote } from '@finagent/core'
import { ProviderRouter } from '../providers/router.ts'
import { createRouterFetchers } from '../providers/router-fetchers.ts'
import { YahooChartFinancialDataProvider } from '../providers/yahoo/adapter.ts'
import { buildHeatmapSnapshot } from './snapshot.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

// Synthetic HTTP fixture: exercises the real adapter/router, not a live Yahoo claim.
function installChartFixture(status = 200): string[] {
  const urls: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ chart: { error: null, result: [{
      meta: {
        symbol: 'AAPL', currency: 'USD', longName: 'Apple Inc.',
        regularMarketPrice: 190.5, previousClose: 189,
        regularMarketTime: 1_699_559_040, regularMarketVolume: 48_000_000,
      },
      timestamp: [1_699_559_040],
      indicators: { quote: [{ open: [189.4], high: [191.2], low: [188.4], close: [190.5], volume: [48_000_000] }] },
    }] } }), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return urls
}

function setup() {
  const router = new ProviderRouter({ timeoutMs: 1_000 })
  for (const [id, code] of [['longbridge', 'AUTH_EXPIRED'], ['massive', 'CONFIG_MISSING']]) {
    router.register({
      kind: 'financial-data', id, name: id,
      status: async () => ({ status: 'not-connected', lastCheck: 0 }),
      capabilities: () => ['market.quote', 'company.profile'],
      markets: () => [{ id: 'US', name: 'United States' }],
      execute: async () => ({ ok: false, error: { code, message: 'Fixture unavailable' } }),
    })
  }
  router.register(new YahooChartFinancialDataProvider())
  router.setRouting({ primary: 'longbridge', fallback: 'massive' })
  const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG)
  return { router, fetchers: createRouterFetchers(router, { resolve: (symbol) => resolver.resolve(symbol) }) }
}

describe('Yahoo router → heatmap (HTTP fixtures)', () => {
  it('matches router MarketSource and preserves delayed fallback provenance and unknown industry', async () => {
    const urls = installChartFixture()
    const { fetchers } = setup()
    const result = await fetchers.getQuoteResult('AAPL.US')
    const profile = await fetchers.getStaticInfo('AAPL.US')
    const instrument = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!
    const cell = buildHeatmapSnapshot({ snapshotId: 'yahoo-fixture', mode: 'watchlist', entries: [{
      instrument, quote: { ok: true, ...result },
    }] }).groups[0].cells[0]

    expect(urls.length).toBeGreaterThan(0)
    expect(profile.name).toBe('Apple Inc.')
    expect(profile).not.toHaveProperty('sector')
    expect(urls.every((url) => url.startsWith('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?'))).toBe(true)
    expect(cell.source).toEqual(result.data.source!)
    expect(cell.source).toEqual({ providerId: 'yahoo', providerName: 'Yahoo Finance', delayed: true })
    expect(cell).toMatchObject({
      instrumentId: 'XNAS:AAPL', quoteStatus: 'delayed', sector: null,
      quoteTimestamp: 1_699_559_040, changePercent: (1.5 / 189) * 100,
      provenance: { providerId: 'yahoo', marketTime: 1_699_559_040_000, delayed: true, stale: false },
    })
    expect(cell.provenance!.failoverTrail).toEqual([
      expect.objectContaining({ providerId: 'longbridge', code: 'AUTH_EXPIRED' }),
      expect.objectContaining({ providerId: 'massive', code: 'CONFIG_MISSING' }),
    ])
    expect(cell.provenance!.fetchedAt).toBe(result.provenance.fetchedAt)
    cell.provenance!.failoverTrail![0].code = 'changed'
    expect(result.provenance.failoverTrail![0].code).toBe('AUTH_EXPIRED')
    cell.source!.providerName = 'changed'
    expect(result.data.source!.providerName).toBe('Yahoo Finance')
  })

  it('keeps a failed Yahoo request as an error instead of a flat quote', async () => {
    installChartFixture(429)
    const { router } = setup()
    const instrument = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!
    const result = await router.execute<Quote>('market.quote', { instrument })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failure')
    expect(result.error.code).toBe('RATE_LIMITED')
    const cell = buildHeatmapSnapshot({ snapshotId: 'yahoo-rate-limit', mode: 'watchlist', entries: [{
      instrument, quote: result,
    }] }).groups[0].cells[0]
    expect(cell).toMatchObject({ changePercent: null, quoteStatus: 'error', errorCode: 'RATE_LIMITED', sector: null })
    expect(cell.source).toBeUndefined()
  })
})

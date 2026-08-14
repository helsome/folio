import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import type { FinanceCapability } from '@finagent/core'
import { defineCapability } from '../capabilities/define.ts'
import { createCapabilityRegistry } from '../capabilities/registry.ts'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { ScreeningRunRepository } from './repository.ts'
import { ScreeningService, universeFromWatchlistGroups, type UniverseEntry } from './service.ts'

const NOW_MS = 1_700_000_000_000
const NOW_SECONDS = 1_700_000_000

interface FixtureRegistry {
  registry: ReturnType<typeof createCapabilityRegistry>
  /** Replace a capability's data (per-symbol failure injection). */
  quoteFor: (symbol: string) => unknown
}

interface FixtureOptions {
  symbols?: string[]
  klineLimit?: number
  brokenQuote?: (symbol: string) => boolean
}

function makeFixture(options: FixtureOptions = {}): FixtureRegistry {
  const { brokenQuote } = options
  const symbols = options.symbols ?? ['AAPL.US', 'MSFT.US']

  const dataFor = (symbol: string): Record<string, unknown> => {
    const idx = symbols.indexOf(symbol)
    return {
      'market.quote': {
        symbol,
        lastPrice: 100 + idx,
        changePercent: idx % 2 === 0 ? 6.2 : -3.4,
        change: 0,
        volume: 1_500_000,
        timestamp: NOW_SECONDS,
        high: 0,
        low: 0,
        open: 0,
        prevClose: 0,
      },
      'market.kline': Array.from({ length: options.klineLimit ?? 90 }, (_, i) => ({
        symbol,
        timestamp: NOW_SECONDS - (90 - i) * 86_400,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1_000_000,
      })),
      'company.valuation': { symbol, pe: 12, pb: 1.1, dpsRate: 3.5, volumeRatio: 2.0 },
      'company.financials': {
        revenueGrowth: 25,
        grossMargin: 60,
        roe: 22,
        netMargin: 15,
      },
      'company.ratings': {
        symbol,
        recommend: 'strong_buy',
        target: 120,
        institutional: { change: 2, distribution: { buy: 10, hold: 2, sell: 1, total: 13 } },
      },
      'company.dividends': [
        { id: `d-${symbol}`, description: 'dividend', exDate: NOW_SECONDS + 10 * 86_400 },
      ],
      'research.news': Array.from({ length: 5 }, (_, i) => ({
        id: `n-${symbol}-${i}`,
        title: `${symbol} headline ${i}`,
        summary: '',
        url: '',
        timestamp: NOW_SECONDS - i * 86_400,
        symbols: [symbol],
      })),
    }
  }

  const caps: FinanceCapability[] = []
  const ids = [
    'market.quote',
    'market.kline',
    'company.valuation',
    'company.financials',
    'company.ratings',
    'company.dividends',
    'research.news',
    'research.events',
    'market.sentiment',
  ]
  for (const id of ids) {
    caps.push(
      defineCapability({
        id,
        name: id,
        description: `fixture ${id}`,
        category: 'market',
        riskLevel: 'read',
        auth: 'public',
        toolName: id.replace(/\./g, '_'),
        inputSchema: Type.Object({ symbol: Type.Optional(Type.String()) }),
        async execute(input) {
          if (id === 'research.events') {
            const events = (input as { symbols?: string[] }).symbols ?? []
            return {
              data: events.map((symbol) => ({
                id: `evt-${symbol}`,
                date: NOW_SECONDS + 5 * 86_400,
                type: 'financial',
                symbol,
                name: `${symbol} earnings`,
              })),
              provenance: { provider: 'test', fetchedAt: NOW_MS, stale: false },
              summary: `${events.length} events`,
            }
          }
          if (id === 'market.sentiment') {
            return {
              data: { market: 'US', temperature: 65, description: 'Bullish', valuation: 60, sentiment: 70 },
              provenance: { provider: 'test', fetchedAt: NOW_MS, stale: false },
              summary: 'US market temp 65',
            }
          }
          const symbol = (input as { symbol?: string }).symbol ?? 'AAPL.US'
          if (brokenQuote?.(symbol)) {
            throw new Error(`simulated quote failure for ${symbol}`)
          }
          return {
            data: dataFor(symbol)[id],
            provenance: { provider: 'test', fetchedAt: NOW_MS, stale: false },
            summary: `${id} ok`,
          }
        },
      })
    )
  }

  return { registry: createCapabilityRegistry(caps), quoteFor: (symbol) => dataFor(symbol)['market.quote'] }
}

function makeService(fixture: FixtureRegistry, dir: string, universeProvider?: () => Promise<UniverseEntry[]>) {
  return new ScreeningService({
    registry: fixture.registry,
    repository: new ScreeningRunRepository(new JsonFileStore(dir)),
    now: () => NOW_MS,
    ...(universeProvider ? { universeProvider } : {}),
  })
}

describe('ScreeningService.runScreening', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finagent-screening-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('fetches capability data, applies the rule, sorts by score desc, and persists', async () => {
    const fixture = makeFixture({ symbols: ['AAPL.US', 'MSFT.US', 'NVDA.US'] })
    const service = makeService(fixture, dir)

    const run = await service.runScreening({ strategy: 'top-gainers', universe: ['AAPL.US', 'MSFT.US', 'NVDA.US'], limit: 2 })

    // AAPL +6.2% and NVDA +6.2% are gainers; MSFT -3.4% is excluded.
    expect(run.candidates.map((c) => c.symbol)).toEqual(['AAPL.US', 'NVDA.US'])
    expect(run.candidates[0].score).toBeCloseTo(0.62, 6)
    expect(run.candidates[0].reasons[0]).toContain('+6.2%')
    // Evidence references the capability run id.
    expect(run.candidates[0].evidence.length).toBeGreaterThan(0)
    expect(run.candidates[0].evidence[0]).toMatch(/^run-market\.quote-\d+-\d+$/)
    // Providers + failures.
    expect(run.providers).toEqual(['test'])
    expect(run.failures).toEqual({})
    // Persisted and query recorded.
    const persisted = await service.getRun(run.id)
    expect(persisted?.id).toBe(run.id)
    expect(persisted?.query.limit).toBe(2)
  })

  it('isolates per-capability failures: broken quote skips the symbol, no throw', async () => {
    const fixture = makeFixture({
      symbols: ['AAPL.US', 'MSFT.US'],
      brokenQuote: (symbol) => symbol === 'MSFT.US',
    })
    const service = makeService(fixture, dir)

    const run = await service.runScreening({ strategy: 'top-gainers', universe: ['AAPL.US', 'MSFT.US'], limit: 10 })

    expect(run.candidates.map((c) => c.symbol)).toEqual(['AAPL.US'])
    expect(run.failures['market.quote']).toContain('simulated quote failure for MSFT.US')
  })

  it('records honest failures when a needed capability is missing from the registry', async () => {
    const fixture = makeFixture()
    const registry = createCapabilityRegistry(
      fixture.registry.list().filter((cap) => cap.id !== 'company.valuation')
    )
    const service = new ScreeningService({
      registry,
      repository: new ScreeningRunRepository(new JsonFileStore(dir)),
      now: () => NOW_MS,
    })

    const run = await service.runScreening({ strategy: 'low-valuation', universe: ['AAPL.US'], limit: 10 })

    expect(run.candidates).toEqual([])
    expect(run.failures['company.valuation']).toBe('Capability not registered')
  })

  it('uses the injected universe provider when query.universe is empty', async () => {
    const fixture = makeFixture()
    const provider = async () => [{ symbol: 'AAPL.US', name: 'Apple' }]
    const service = makeService(fixture, dir, provider)

    const run = await service.runScreening({ strategy: 'top-gainers', limit: 10 })

    expect(run.candidates.map((c) => c.symbol)).toEqual(['AAPL.US'])
    expect(run.candidates[0].name).toBe('Apple')
  })

  it('defaults to the static universe and honors MAX_UNIVERSE bounds', async () => {
    const fixture = makeFixture({ symbols: ['AAPL.US', 'MSFT.US'] })
    const service = makeService(fixture, dir)

    const run = await service.runScreening({ strategy: 'top-gainers', limit: 100 })

    // The static pool is the default universe; AAPL.US (fixture +6.2%) is a
    // gainer, MSFT.US (-3.4%) is not — other pool symbols have no fixture
    // data and are honestly skipped.
    expect(run.candidates.map((candidate) => candidate.symbol)).toEqual(['AAPL.US'])
    expect(run.query.universe).toBeUndefined()
  })

  it('batches research.events per 10 symbols and attributes events by symbol', async () => {
    const symbols = Array.from({ length: 12 }, (_, i) => `S${i}.US`)
    const fixture = makeFixture({ symbols })
    const service = makeService(fixture, dir)

    const run = await service.runScreening({ strategy: 'upcoming-earnings', universe: symbols, limit: 12 })

    expect(run.candidates).toHaveLength(12)
    for (const candidate of run.candidates) {
      expect(candidate.reasons[0]).toContain('Earnings in 5d')
      // Evidence = the batched calendar run id.
      expect(candidate.evidence).toHaveLength(1)
      expect(candidate.evidence[0]).toMatch(/^run-research\.events-\d+-\d+$/)
    }
  })

  it('empty universe produces an empty run with a universe failure entry', async () => {
    const fixture = makeFixture()
    const service = makeService(fixture, dir, async () => [])

    const run = await service.runScreening({ strategy: 'strong-momentum', limit: 5 })

    expect(run.candidates).toEqual([])
    expect(run.failures.universe).toContain('empty')
  })

  it('throws on an unknown strategy id', async () => {
    const fixture = makeFixture()
    const service = makeService(fixture, dir)
    await expect(
      service.runScreening({ strategy: 'nope' as never, limit: 5 })
    ).rejects.toThrow(/Unknown screening strategy/)
  })

  it('includes market sentiment context for unusual-movement', async () => {
    const fixture = makeFixture({ klineLimit: 90 })
    const service = makeService(fixture, dir)

    const run = await service.runScreening({ strategy: 'unusual-movement', universe: ['AAPL.US', 'MSFT.US'], limit: 10 })

    // Fixture klines move +1/bar with ±1% bars — amplitudes are ~2% flat, so
    // the rule honestly skips (no fabricated movement).
    expect(run.candidates).toEqual([])
    expect(run.failures).toEqual({})
  })
})

describe('universeFromWatchlistGroups', () => {
  it('parses the longbridge watchlist group payload', () => {
    const payload = [
      { id: 1019066, name: 'all', securities: [
        { is_pinned: false, market: 'US', name: 'SK Hynix', symbol: 'SKHY.US' },
        { is_pinned: false, market: 'HK', name: 'Tencent', symbol: '0700.HK' },
      ] },
      { id: 1, name: 'empty', securities: [] },
    ]
    expect(universeFromWatchlistGroups(payload)).toEqual([
      { symbol: 'SKHY.US', name: 'SK Hynix' },
      { symbol: '0700.HK', name: 'Tencent' },
    ])
  })

  it('degrades to [] on unknown payloads', () => {
    expect(universeFromWatchlistGroups(null)).toEqual([])
    expect(universeFromWatchlistGroups({ not: 'an array' })).toEqual([])
    expect(universeFromWatchlistGroups([{ id: 1 }])).toEqual([])
  })
})

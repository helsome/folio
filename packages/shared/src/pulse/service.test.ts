import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import type {
  FinanceCapability,
  MarketStatus,
  MarketTemperature,
  PortfolioSnapshot,
  Quote,
  ScreeningCandidate,
} from '@finagent/core'
import { defineCapability } from '../capabilities/define.ts'
import { createCapabilityRegistry } from '../capabilities/registry.ts'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { ScreeningRunRepository } from '../screening/repository.ts'
import { ScreeningService, type UniverseEntry } from '../screening/service.ts'
import {
  PulseService,
  computePersonalImpact,
  impactSign,
  mapTemperature,
  partitionMovers,
  portfolioExposurePercent,
  type IndexDescriptor,
} from './service.ts'

const NOW_MS = 1_700_000_000_000
const NOW_SECONDS = 1_700_000_000

// ── Fixtures ────────────────────────────────────────────────────────────────

interface FixtureOptions {
  /** symbol → changePercent for the quote capability. */
  quotes?: Record<string, number>
  statuses?: MarketStatus[]
  temperature?: MarketTemperature
  /** capability ids whose execute throws. */
  broken?: string[]
  /** capability ids that are not registered at all. */
  missing?: string[]
}

interface Fixture {
  registry: ReturnType<typeof createCapabilityRegistry>
}

function makeQuote(symbol: string, changePercent: number): Quote {
  return {
    symbol,
    lastPrice: 100,
    change: 1,
    changePercent,
    volume: 1_000,
    timestamp: NOW_SECONDS,
    high: 101,
    low: 99,
    open: 100,
    prevClose: 99,
  }
}

const DEFAULT_STATUSES: MarketStatus[] = [{ market: 'US', status: 'Open' }]
const DEFAULT_TEMPERATURE: MarketTemperature = {
  market: 'US',
  temperature: 62,
  description: 'Warm',
  valuation: 55,
  sentiment: 60,
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const quotes = options.quotes ?? {}
  const broken = new Set(options.broken ?? [])
  const missing = new Set(options.missing ?? [])
  const caps: FinanceCapability[] = []

  if (!missing.has('market.quote')) {
    caps.push(
      defineCapability({
        id: 'market.quote',
        name: 'Quote',
        description: 'Fixture quote capability',
        toolName: 'get_quote',
        category: 'market',
        riskLevel: 'read',
        auth: 'public',
        inputSchema: Type.Object({ symbol: Type.String() }),
        async execute(input: { symbol: string }) {
          if (broken.has('market.quote')) throw new Error('quote provider down')
          const changePercent = quotes[input.symbol]
          if (changePercent === undefined) throw new Error(`no quote for ${input.symbol}`)
          return {
            data: makeQuote(input.symbol, changePercent),
            provenance: { provider: 'longbridge', fetchedAt: NOW_MS, stale: false },
            summary: '',
          }
        },
      })
    )
  }

  if (!missing.has('market.status')) {
    caps.push(
      defineCapability({
        id: 'market.status',
        name: 'Market Status',
        description: 'Fixture market status capability',
        toolName: 'get_market_status',
        category: 'market',
        riskLevel: 'read',
        auth: 'public',
        inputSchema: Type.Object({}),
        async execute() {
          if (broken.has('market.status')) throw new Error('status provider down')
          return {
            data: options.statuses ?? DEFAULT_STATUSES,
            provenance: { provider: 'longbridge', fetchedAt: NOW_MS, stale: false },
            summary: '',
          }
        },
      })
    )
  }

  if (!missing.has('market.sentiment')) {
    caps.push(
      defineCapability({
        id: 'market.sentiment',
        name: 'Market Sentiment',
        description: 'Fixture sentiment capability',
        toolName: 'get_market_sentiment',
        category: 'market',
        riskLevel: 'read',
        auth: 'public',
        inputSchema: Type.Object({ market: Type.Optional(Type.String()) }),
        async execute() {
          if (broken.has('market.sentiment')) throw new Error('sentiment provider down')
          return {
            data: options.temperature ?? DEFAULT_TEMPERATURE,
            provenance: { provider: 'longbridge', fetchedAt: NOW_MS, stale: false },
            summary: '',
          }
        },
      })
    )
  }

  return { registry: createCapabilityRegistry(caps) }
}

const DEFAULT_UNIVERSE: UniverseEntry[] = [
  { symbol: 'AAPL.US' },
  { symbol: 'MSFT.US' },
  { symbol: 'NVDA.US' },
  { symbol: 'TSLA.US' },
]

/** Quotes that make every universe symbol a mover (≥ MIN_DAY_MOVE_PCT = 1). */
const MOVER_QUOTES: Record<string, number> = {
  'AAPL.US': 6.2,
  'MSFT.US': -3.4,
  'NVDA.US': 4.1,
  'TSLA.US': -2.2,
}

/** MOVER_QUOTES plus quotes for the three default index symbols. */
const QUOTES_WITH_INDICES: Record<string, number> = {
  ...MOVER_QUOTES,
  'SPX.US': 0.5,
  'NDX.US': 0.3,
  'HSI.HK': -0.2,
}

async function makeService(
  fixture: Fixture,
  dir: string,
  options: { universe?: UniverseEntry[]; indices?: IndexDescriptor[]; screening?: ScreeningService } = {}
): Promise<PulseService> {
  const screening =
    options.screening ??
    new ScreeningService({
      registry: fixture.registry,
      repository: new ScreeningRunRepository(new JsonFileStore(dir)),
      universeProvider: async () => options.universe ?? DEFAULT_UNIVERSE,
    })
  return new PulseService({
    registry: fixture.registry,
    screening,
    now: () => NOW_MS,
    ...(options.indices ? { indices: options.indices } : {}),
  })
}

const PORTFOLIO: PortfolioSnapshot = {
  totalAssets: 10_000,
  accounts: [],
  holdings: [
    { symbol: 'AAPL.US', name: 'Apple', marketValueBase: 1_500, marketValue: 1_500 },
    { symbol: 'MSFT.US', name: 'Microsoft', marketValue: 2_500 },
    { symbol: 'GOOGL.US', name: 'Alphabet', marketValueBase: 4_000 },
  ],
  fetchedAt: NOW_MS,
}

function candidate(symbol: string, changePercent: number): ScreeningCandidate {
  return {
    symbol,
    name: symbol,
    score: 0.5,
    reasons: [`Day change ${changePercent}%`],
    metrics: { changePercent, lastPrice: 100 },
    evidence: [],
  }
}

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-pulse-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('impactSign', () => {
  it('maps positive/negative/zero/undefined to the impact direction', () => {
    expect(impactSign(5)).toBe('positive')
    expect(impactSign(-5)).toBe('negative')
    expect(impactSign(0)).toBe('neutral')
    expect(impactSign(undefined)).toBe('neutral')
  })
})

describe('mapTemperature', () => {
  it('maps a full MarketTemperature into the chip shape', () => {
    expect(
      mapTemperature({ market: 'US', temperature: 62, description: 'Warm', valuation: 55, sentiment: 60 })
    ).toEqual({ score: 62, label: 'Warm', market: 'US' })
  })

  it('omits label/market when absent, and nulls on invalid data', () => {
    expect(mapTemperature({ market: 'HK', temperature: 30, description: '', valuation: 40, sentiment: 20 })).toEqual({
      score: 30,
      market: 'HK',
    })
    expect(mapTemperature({ temperature: 'n/a', description: 'x', valuation: 0, sentiment: 0 })).toBeNull()
    expect(mapTemperature(null)).toBeNull()
    expect(mapTemperature('62')).toBeNull()
  })
})

describe('partitionMovers', () => {
  it('splits by change sign and drops zero-change candidates', () => {
    const movers = [candidate('A.US', 2.5), candidate('B.US', -1.5), candidate('C.US', 0)]
    const { gainers, losers } = partitionMovers(movers)
    expect(gainers.map((c) => c.symbol)).toEqual(['A.US'])
    expect(losers.map((c) => c.symbol)).toEqual(['B.US'])
  })

  it('is empty-safe', () => {
    const { gainers, losers } = partitionMovers([])
    expect(gainers).toEqual([])
    expect(losers).toEqual([])
  })
})

describe('portfolioExposurePercent', () => {
  it('prefers marketValueBase, falls back to marketValue, over totalAssets', () => {
    expect(portfolioExposurePercent('AAPL.US', PORTFOLIO)).toBe(15)
    expect(portfolioExposurePercent('MSFT.US', PORTFOLIO)).toBe(25)
    expect(portfolioExposurePercent('NVDA.US', PORTFOLIO)).toBeUndefined()
  })

  it('returns undefined without a snapshot or when totalAssets is missing', () => {
    expect(portfolioExposurePercent('AAPL.US')).toBeUndefined()
    expect(portfolioExposurePercent('AAPL.US', { ...PORTFOLIO, totalAssets: undefined })).toBeUndefined()
  })
})

describe('computePersonalImpact', () => {
  const movers = [
    candidate('AAPL.US', 6.2),
    candidate('MSFT.US', -3.4),
    candidate('NVDA.US', 4.1),
    candidate('TSLA.US', -2.2),
  ]
  const watchlist = [
    { symbol: 'AAPL.US', lastPrice: 100 },
    { symbol: 'TSLA.US', lastPrice: 100 },
    { symbol: 'MSFT.US', lastPrice: 100 },
  ]

  it('computes watchlist weight shares and impact signs for overlapping movers', () => {
    const impact = computePersonalImpact(movers, watchlist, PORTFOLIO)
    expect(impact).not.toBeNull()
    expect(impact!.scope).toBe('watchlist')
    // watchlist total = 300; each present mover has 100/300 = 33.33%
    expect(impact!.items).toEqual([
      {
        symbol: 'AAPL.US',
        changePercent: 6.2,
        watchlistExposurePercent: 33.33,
        portfolioExposurePercent: 15,
        impact: 'positive',
      },
      {
        symbol: 'TSLA.US',
        changePercent: -2.2,
        watchlistExposurePercent: 33.33,
        portfolioExposurePercent: undefined,
        impact: 'negative',
      },
      {
        symbol: 'MSFT.US',
        changePercent: -3.4,
        watchlistExposurePercent: 33.33,
        portfolioExposurePercent: 25,
        impact: 'negative',
      },
    ])
  })

  it('skips movers not in the watchlist and watchlist entries that are not movers', () => {
    const impact = computePersonalImpact([movers[0]], watchlist, PORTFOLIO)
    expect(impact!.items.map((item) => item.symbol)).toEqual(['AAPL.US'])
  })

  it('returns null when nothing overlaps', () => {
    expect(computePersonalImpact([movers[0]], [{ symbol: 'GOOGL.US', lastPrice: 50 }])).toBeNull()
    expect(computePersonalImpact(movers, [])).toBeNull()
    expect(computePersonalImpact([], watchlist)).toBeNull()
  })

  it('handles missing quote data: exposure undefined, impact neutral', () => {
    const impact = computePersonalImpact([candidate('AAPL.US', 2)], [{ symbol: 'AAPL.US', lastPrice: undefined }])
    expect(impact!.items[0].watchlistExposurePercent).toBeUndefined()
    expect(impact!.items[0].portfolioExposurePercent).toBeUndefined()
    expect(impact!.items[0].impact).toBe('positive')
    const neutral = computePersonalImpact([candidate('AAPL.US', 0)], [{ symbol: 'AAPL.US', lastPrice: 100 }])
    expect(neutral!.items[0].impact).toBe('neutral')
  })
})

// ── Service snapshot ────────────────────────────────────────────────────────

describe('PulseService.snapshot', () => {
  it('returns real index quotes, market status, temperature and movers', async () => {
    const fixture = makeFixture({ quotes: QUOTES_WITH_INDICES })
    const service = await makeService(fixture, dir, {
      indices: [
        { symbol: 'SPX.US', name: 'S&P 500' },
        { symbol: 'NDX.US', name: 'Nasdaq 100' },
      ],
    })
    const snapshot = await service.snapshot({
      watchlist: [{ symbol: 'AAPL.US', lastPrice: 100 }],
      portfolioSummary: PORTFOLIO,
    })

    expect(snapshot.indices).toEqual([
      { symbol: 'SPX.US', name: 'S&P 500', lastPrice: 100, changePercent: 0.5 },
      { symbol: 'NDX.US', name: 'Nasdaq 100', lastPrice: 100, changePercent: 0.3 },
    ])
    expect(snapshot.marketStatus).toEqual(DEFAULT_STATUSES)
    expect(snapshot.temperature).toEqual({ score: 62, label: 'Warm', market: 'US' })
    // top 3 gainers + top 3 losers → all 4 universe movers (2 gainers, 2 losers)
    expect(snapshot.movers.map((c) => c.symbol)).toEqual(['AAPL.US', 'NVDA.US', 'MSFT.US', 'TSLA.US'])
    expect(snapshot.movers.map((c) => c.metrics.changePercent)).toEqual([6.2, 4.1, -3.4, -2.2])
    expect(snapshot.personalImpact?.items[0].symbol).toBe('AAPL.US')
    expect(snapshot.failures).toEqual([])
    expect(snapshot.generatedAt).toBe(NOW_MS)
  })

  it('records a failure note for index symbols the quote capability cannot serve', async () => {
    const fixture = makeFixture({ quotes: { 'SPX.US': 1.2 } })
    const service = await makeService(fixture, dir, {
      indices: [
        { symbol: 'SPX.US', name: 'S&P 500' },
        { symbol: 'NDX.US', name: 'Nasdaq 100' },
      ],
    })
    const snapshot = await service.snapshot({ watchlist: [], market: 'US' })
    // one real quote, one missing → the missing one is dropped, note recorded
    expect(snapshot.indices).toHaveLength(1)
    expect(snapshot.failures.some((note) => note.startsWith('market.quote'))).toBe(true)
  })

  it('isolation: one capability down → its section degrades, the rest still serve', async () => {
    const fixture = makeFixture({ quotes: QUOTES_WITH_INDICES, broken: ['market.status'] })
    const service = await makeService(fixture, dir)
    const snapshot = await service.snapshot({ watchlist: [], market: 'US' })

    expect(snapshot.marketStatus).toBeNull()
    expect(snapshot.failures.some((note) => note.startsWith('market.status'))).toBe(true)
    // the other sections are unaffected
    expect(snapshot.indices).toHaveLength(3)
    expect(snapshot.temperature).toEqual({ score: 62, label: 'Warm', market: 'US' })
    expect(snapshot.movers).toHaveLength(4)
  })

  it('missing capability → empty section + failure note, never a throw', async () => {
    const fixture = makeFixture({ quotes: QUOTES_WITH_INDICES, missing: ['market.status', 'market.sentiment'] })
    const service = await makeService(fixture, dir)
    const snapshot = await service.snapshot({ watchlist: [], market: 'US' })

    expect(snapshot.marketStatus).toBeNull()
    expect(snapshot.temperature).toBeNull()
    expect(snapshot.failures.some((note) => note.startsWith('market.status'))).toBe(true)
    expect(snapshot.failures.some((note) => note.startsWith('market.sentiment'))).toBe(true)
    expect(snapshot.movers).toHaveLength(4)
  })

  it('no quote capability → indices empty with a note', async () => {
    const fixture = makeFixture({ missing: ['market.quote'] })
    const service = await makeService(fixture, dir)
    const snapshot = await service.snapshot({ watchlist: [] })

    expect(snapshot.indices).toEqual([])
    expect(snapshot.failures.some((note) => note.startsWith('market.quote'))).toBe(true)
  })

  it('screening failure → movers empty + note, snapshot still resolves', async () => {
    const fixture = makeFixture({ quotes: QUOTES_WITH_INDICES })
    const brokenScreening = {
      runScreening: async () => {
        throw new Error('screening down')
      },
    } as unknown as ScreeningService
    const service = await makeService(fixture, dir, { screening: brokenScreening })
    const snapshot = await service.snapshot({ watchlist: [] })

    expect(snapshot.movers).toEqual([])
    expect(snapshot.personalImpact).toBeNull()
    expect(snapshot.failures.some((note) => note.startsWith('screening:'))).toBe(true)
    // other sections still served
    expect(snapshot.indices).toHaveLength(3)
    expect(snapshot.marketStatus).toEqual(DEFAULT_STATUSES)
  })

  it('never throws when every capability is down', async () => {
    const fixture = makeFixture({ missing: ['market.quote', 'market.status', 'market.sentiment'] })
    const brokenScreening = {
      runScreening: async () => {
        throw new Error('screening down')
      },
    } as unknown as ScreeningService
    const service = await makeService(fixture, dir, { screening: brokenScreening })
    const snapshot = await service.snapshot({ watchlist: [{ symbol: 'AAPL.US', lastPrice: 100 }] })

    expect(snapshot.indices).toEqual([])
    expect(snapshot.marketStatus).toBeNull()
    expect(snapshot.temperature).toBeNull()
    expect(snapshot.movers).toEqual([])
    expect(snapshot.personalImpact).toBeNull()
    expect(snapshot.failures.length).toBeGreaterThanOrEqual(3)
  })
})

import type {
  CapabilityRegistry,
  MarketStatus,
  MarketTemperature,
  PortfolioSnapshot,
  ScreeningCandidate,
} from '@finagent/core'
import { CapabilityExecutor, type RunOutcome } from '../capabilities/executor.ts'
import { isRecord, toFiniteNumber } from '../guards.ts'
import type { ScreeningService } from '../screening/service.ts'

/**
 * Market Pulse (spec §51–52): a compact, honest market snapshot for the Today
 * dashboard. Every number is REAL capability data — indices come from
 * `market.quote` runs, session status from `market.status`, temperature from
 * `market.sentiment`, movers from the screening service. When a capability is
 * missing or fails, its section degrades to an empty/null value and a
 * user-safe failure note lands in `failures`; the snapshot NEVER throws and
 * NEVER fabricates a number.
 *
 * Personal impact (§52, first version: watchlist exposure) maps movers back
 * onto the user's own context: watchlist weight share (computed from the
 * quote data TodayView already holds) and portfolio exposure (from the broker
 * snapshot TodayView already loaded). All of the mapping is pure and
 * injectable, so it is unit-testable without Electron or provider code.
 */

/** One index line shown in the pulse card — REAL data only, from `market.quote`. */
export interface MarketIndex {
  symbol: string
  /** Static display name; never derived from vendor output. */
  name: string
  lastPrice?: number
  changePercent?: number
}

/** Mapped `MarketTemperature` (0–100 score) for the pulse chip. */
export interface MarketPulseTemperature {
  score?: number
  label?: string
  market?: string
}

export type ImpactSign = 'positive' | 'negative' | 'neutral'

/** One "what matters to me" row: a mover the user also holds/watches. */
export interface PersonalImpactItem {
  symbol: string
  changePercent?: number
  /** Share of the watchlist market value (equal units × quote last price). */
  watchlistExposurePercent?: number
  /** Share of portfolio total assets (holding market value / totalAssets). */
  portfolioExposurePercent?: number
  /** Direction of the potential impact, from the mover's change sign. */
  impact: ImpactSign
}

export interface PersonalImpact {
  /** Which user context is mapped. First version: watchlist only. */
  scope: 'watchlist'
  items: PersonalImpactItem[]
}

/** A watchlist symbol with its latest cached quote (TodayView passes these in). */
export interface WatchlistQuote {
  symbol: string
  lastPrice?: number
}

export interface PulseSnapshotContext {
  /** Watchlist symbols with their cached quote prices (quoteCacheAtomFamily). */
  watchlist: WatchlistQuote[]
  /** Broker portfolio snapshot when TodayView has loaded one. */
  portfolioSummary?: PortfolioSnapshot
  /** Market code scoping the temperature read; defaults to `US`. */
  market?: string
}

export interface MarketPulseSnapshot {
  /** Empty when `market.quote` is unavailable (never fabricated). */
  indices: MarketIndex[]
  /** `null` when `market.status` is unavailable; `[]` when it returns none. */
  marketStatus: MarketStatus[] | null
  temperature: MarketPulseTemperature | null
  /** Top 3 gainers + top 3 losers, gainers first (screening service). */
  movers: ScreeningCandidate[]
  personalImpact: PersonalImpact | null
  /** User-safe notes for every capability that could not serve data. */
  failures: string[]
  generatedAt: number
}

export interface IndexDescriptor {
  symbol: string
  name: string
}

/** Default index line-up; symbols are lookups into `market.quote` (real data only). */
export const DEFAULT_INDICES: IndexDescriptor[] = [
  { symbol: 'SPX.US', name: 'S&P 500' },
  { symbol: 'NDX.US', name: 'Nasdaq 100' },
  { symbol: 'HSI.HK', name: 'Hang Seng' },
]

export interface PulseServiceOptions {
  registry: CapabilityRegistry
  screening: ScreeningService
  executor?: CapabilityExecutor
  /** Index line-up; defaults to the static list. */
  indices?: IndexDescriptor[]
  now?: () => number
}

const QUOTE_TIMEOUT_MS = 15_000
const MOVER_LIMIT = 3

export class PulseService {
  private readonly registry: CapabilityRegistry
  private readonly screening: ScreeningService
  private readonly executor: CapabilityExecutor
  private readonly indices: IndexDescriptor[]
  private readonly now: () => number

  constructor(options: PulseServiceOptions) {
    this.registry = options.registry
    this.screening = options.screening
    this.now = options.now ?? Date.now
    this.executor = options.executor ?? new CapabilityExecutor({ now: this.now })
    this.indices = options.indices ?? DEFAULT_INDICES
  }

  /** Build one market-pulse snapshot; never throws, sections degrade + record failures. */
  async snapshot(ctx: PulseSnapshotContext): Promise<MarketPulseSnapshot> {
    const failures: string[] = []
    const [indices, marketStatus, temperature, movers] = await Promise.all([
      this.loadIndices(failures),
      this.loadMarketStatus(failures),
      this.loadTemperature(ctx.market ?? 'US', failures),
      this.loadMovers(failures),
    ])
    return {
      indices,
      marketStatus,
      temperature,
      movers,
      personalImpact: computePersonalImpact(movers, ctx.watchlist, ctx.portfolioSummary),
      failures: [...new Set(failures)],
      generatedAt: this.now(),
    }
  }

  // ── Section loaders (each isolated; failures degrade, never throw) ────────

  private async loadIndices(failures: string[]): Promise<MarketIndex[]> {
    if (this.indices.length === 0) return []
    const capability = this.registry.get('market.quote')
    if (!capability) {
      failures.push('market.quote unavailable: capability not registered — index quotes not shown')
      return []
    }
    const outcomes = await this.executor.runAll(
      this.indices.map((descriptor) => ({ cap: capability, input: { symbol: descriptor.symbol } })),
      { timeoutMs: QUOTE_TIMEOUT_MS }
    )
    const indices: MarketIndex[] = []
    for (let i = 0; i < outcomes.length; i += 1) {
      const descriptor = this.indices[i]
      const outcome = outcomes[i]
      if (!descriptor || !outcome) continue
      const quote = readIndexQuote(outcome)
      if (!quote) continue
      indices.push({
        symbol: quote.symbol,
        name: descriptor.name,
        lastPrice: quote.lastPrice,
        ...(quote.changePercent !== undefined ? { changePercent: quote.changePercent } : {}),
      })
    }
    if (outcomes.some((outcome) => outcome.record.status !== 'success')) {
      failures.push('market.quote: some index quotes could not be fetched')
    }
    return indices
  }

  private async loadMarketStatus(failures: string[]): Promise<MarketStatus[] | null> {
    const capability = this.registry.get('market.status')
    if (!capability) {
      failures.push('market.status unavailable: capability not registered')
      return null
    }
    const outcome = await this.executor.run(capability, {}, { timeoutMs: QUOTE_TIMEOUT_MS })
    if (outcome.record.status !== 'success' || !outcome.result) {
      failures.push(`market.status: ${outcome.record.error ?? 'provider unavailable'}`)
      return null
    }
    return readMarketStatus(outcome.result.data)
  }

  private async loadTemperature(
    market: string,
    failures: string[]
  ): Promise<MarketPulseTemperature | null> {
    const capability = this.registry.get('market.sentiment')
    if (!capability) {
      failures.push('market.sentiment unavailable: capability not registered')
      return null
    }
    const outcome = await this.executor.run(capability, { market }, { timeoutMs: QUOTE_TIMEOUT_MS })
    if (outcome.record.status !== 'success' || !outcome.result) {
      failures.push(`market.sentiment: ${outcome.record.error ?? 'provider unavailable'}`)
      return null
    }
    return mapTemperature(outcome.result.data)
  }

  private async loadMovers(failures: string[]): Promise<ScreeningCandidate[]> {
    // Sequential on purpose: the screening repository writes runs to one JSON
    // file, and two concurrent saves race on the tmp+rename write.
    const movers: ScreeningCandidate[] = []
    for (const strategy of ['top-gainers', 'top-losers'] as const) {
      try {
        const run = await this.screening.runScreening({ strategy, limit: MOVER_LIMIT })
        movers.push(...run.candidates)
      } catch (error) {
        failures.push(`screening: ${errorMessage(error)}`)
      }
    }
    return movers
  }
}

// ── Pure mapping helpers (exported for the UI + unit tests) ─────────────────

/** Direction of the potential impact from a mover's change sign. */
export function impactSign(changePercent: number | undefined): ImpactSign {
  if (changePercent === undefined || changePercent === 0) return 'neutral'
  return changePercent > 0 ? 'positive' : 'negative'
}

/** Map a `MarketTemperature` into the pulse chip shape; invalid data → null. */
export function mapTemperature(value: unknown): MarketPulseTemperature | null {
  if (!isRecord(value)) return null
  const score = toFiniteNumber(value.temperature)
  if (score === undefined) return null
  const market = typeof value.market === 'string' && value.market.trim() !== '' ? value.market.trim() : undefined
  const label =
    typeof value.description === 'string' && value.description.trim() !== ''
      ? value.description.trim()
      : undefined
  return {
    score,
    ...(market !== undefined ? { market } : {}),
    ...(label !== undefined ? { label } : {}),
  }
}

/** Split the flat movers list into the two card columns (change sign wins). */
export function partitionMovers(
  candidates: ScreeningCandidate[]
): { gainers: ScreeningCandidate[]; losers: ScreeningCandidate[] } {
  const gainers: ScreeningCandidate[] = []
  const losers: ScreeningCandidate[] = []
  for (const candidate of candidates) {
    const changePercent = toFiniteNumber(candidate.metrics.changePercent)
    if (changePercent === undefined || changePercent === 0) continue
    if (changePercent > 0) gainers.push(candidate)
    else losers.push(candidate)
  }
  return { gainers, losers }
}

/**
 * Map movers onto the user's watchlist (+ portfolio when a snapshot is
 * provided). `null` when there is nothing to map (no movers, no watchlist, or
 * no overlap) — the UI then renders its "nothing matters to you" empty state.
 */
export function computePersonalImpact(
  movers: ScreeningCandidate[],
  watchlist: WatchlistQuote[],
  portfolioSummary?: PortfolioSnapshot
): PersonalImpact | null {
  if (movers.length === 0 || watchlist.length === 0) return null
  const bySymbol = new Map<string, ScreeningCandidate>()
  for (const candidate of movers) bySymbol.set(normalizeSymbol(candidate.symbol), candidate)

  const watchlistTotal = watchlist.reduce((sum, entry) => sum + (toFiniteNumber(entry.lastPrice) ?? 0), 0)
  const items: PersonalImpactItem[] = []
  for (const entry of watchlist) {
    const candidate = bySymbol.get(normalizeSymbol(entry.symbol))
    if (!candidate) continue
    const changePercent = toFiniteNumber(candidate.metrics.changePercent)
    const entryValue = toFiniteNumber(entry.lastPrice)
    items.push({
      symbol: candidate.symbol,
      ...(changePercent !== undefined ? { changePercent } : {}),
      watchlistExposurePercent:
        watchlistTotal > 0 && entryValue !== undefined ? round2((entryValue / watchlistTotal) * 100) : undefined,
      portfolioExposurePercent: portfolioExposurePercent(candidate.symbol, portfolioSummary),
      impact: impactSign(changePercent),
    })
  }
  if (items.length === 0) return null
  return { scope: 'watchlist', items }
}

/** Holding market value as a share of portfolio total assets (%), when computable. */
export function portfolioExposurePercent(
  symbol: string,
  portfolio?: PortfolioSnapshot
): number | undefined {
  if (!portfolio) return undefined
  const total = portfolio.totalAssets
  if (total === undefined || !Number.isFinite(total) || total <= 0) return undefined
  const target = normalizeSymbol(symbol)
  for (const holding of portfolio.holdings) {
    if (normalizeSymbol(holding.symbol) !== target) continue
    const weight = holding.marketValueBase ?? holding.marketValue
    if (weight === undefined || !Number.isFinite(weight)) return undefined
    return round2((weight / total) * 100)
  }
  return undefined
}

// ── Boundary guards (typed at source, `unknown` after the executor erases) ──

interface IndexQuote {
  symbol: string
  lastPrice: number
  changePercent?: number
}

function readIndexQuote(outcome: RunOutcome): IndexQuote | null {
  if (outcome.record.status !== 'success' || !outcome.result) return null
  const data = outcome.result.data
  if (!isRecord(data)) return null
  const symbol = typeof data.symbol === 'string' ? data.symbol.trim() : ''
  const lastPrice = toFiniteNumber(data.lastPrice)
  if (symbol === '' || lastPrice === undefined) return null
  const changePercent = toFiniteNumber(data.changePercent)
  return { symbol, lastPrice, ...(changePercent !== undefined ? { changePercent } : {}) }
}

function readMarketStatus(data: unknown): MarketStatus[] {
  if (!Array.isArray(data)) return []
  const statuses: MarketStatus[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    const market = typeof entry.market === 'string' ? entry.market.trim() : ''
    const status = typeof entry.status === 'string' ? entry.status.trim() : ''
    if (market === '' || status === '') continue
    statuses.push({ market, status })
  }
  return statuses
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'provider unavailable'
}

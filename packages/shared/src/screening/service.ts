import type {
  CapabilityRegistry,
  CalendarEvent,
  ScreeningCandidate,
  ScreeningQuery,
  ScreeningRun,
} from '@finagent/core'
import { CapabilityExecutor, type RunAllSpec, type RunOutcome } from '../capabilities/index.ts'
import { isRecord } from '../guards.ts'
import { marketForSymbol } from '../alerts/index.ts'
import { ScreeningRunRepository } from './repository.ts'
import {
  getScreeningStrategy,
  type ScreeningStrategyDef,
  type SymbolData,
} from './strategies.ts'

/**
 * Discovery / Screening service (spec §5–10).
 *
 * `runScreening` fetches structured capability data for a BOUNDED universe,
 * applies one deterministic strategy rule per symbol, and returns a sorted
 * shortlist. The LLM never scans the market: everything here is capability
 * data + deterministic filters (spec §7).
 *
 * ## Universe sources (documented)
 *
 * The universe is bounded by design. Sources, in priority order:
 *
 *   1. `query.universe`   — explicit symbol list. The UI passes the user's
 *      watchlist atoms here, so a task runs over the user's own stocks.
 *   2. `universeProvider` — an injected hook (kernel-host wiring). The
 *      recommended implementation reads the user's Longbridge watchlist
 *      groups: `longbridge watchlist --format json` returns
 *      `[{ id, name, securities: [{ symbol, name, market, is_pinned }] }]`.
 *      Feed the parsed payload to `universeFromWatchlistGroups` and map the
 *      entries into `UniverseEntry[]`.
 *   3. `STATIC_UNIVERSE`  — the built-in bounded pool of liquid US/HK/SG
 *      names, used when neither of the above is available.
 *
 * Failures never fabricate data: a capability that is missing, unavailable,
 * or errors is recorded in `run.failures` (capabilityId → user-safe message)
 * and the affected symbols simply produce no candidates.
 */

/** Hard cap on the universe processed per run (deterministic, rate friendly). */
export const MAX_UNIVERSE = 40
const CALENDAR_BATCH = 10 // `research.events` accepts up to 10 --symbol flags
const CALENDAR_COUNT = 60
const KLINE_LIMIT = 90
const CONCURRENCY = 4
const TIMEOUT_MS = 15_000

/** One entry in the bounded universe; `name` feeds the candidate card. */
export interface UniverseEntry {
  symbol: string
  name?: string
}

export type UniverseProvider = () => Promise<UniverseEntry[]>

/** Built-in bounded pool of liquid, well-known names (US/HK/SG). */
export const STATIC_UNIVERSE: UniverseEntry[] = [
  { symbol: 'AAPL.US', name: 'Apple' },
  { symbol: 'MSFT.US', name: 'Microsoft' },
  { symbol: 'NVDA.US', name: 'NVIDIA' },
  { symbol: 'GOOGL.US', name: 'Alphabet' },
  { symbol: 'AMZN.US', name: 'Amazon' },
  { symbol: 'META.US', name: 'Meta Platforms' },
  { symbol: 'TSLA.US', name: 'Tesla' },
  { symbol: 'AMD.US', name: 'Advanced Micro Devices' },
  { symbol: 'INTC.US', name: 'Intel' },
  { symbol: 'QCOM.US', name: 'Qualcomm' },
  { symbol: 'NFLX.US', name: 'Netflix' },
  { symbol: 'DIS.US', name: 'Walt Disney' },
  { symbol: 'BA.US', name: 'Boeing' },
  { symbol: 'WMT.US', name: 'Walmart' },
  { symbol: 'PG.US', name: 'Procter & Gamble' },
  { symbol: 'KO.US', name: 'Coca-Cola' },
  { symbol: 'JPM.US', name: 'JPMorgan Chase' },
  { symbol: 'V.US', name: 'Visa' },
  { symbol: 'MA.US', name: 'Mastercard' },
  { symbol: 'CRM.US', name: 'Salesforce' },
  { symbol: 'ORCL.US', name: 'Oracle' },
  { symbol: 'ADBE.US', name: 'Adobe' },
  { symbol: 'PFE.US', name: 'Pfizer' },
  { symbol: 'MRK.US', name: 'Merck' },
  { symbol: 'JNJ.US', name: 'Johnson & Johnson' },
  { symbol: 'XOM.US', name: 'Exxon Mobil' },
  { symbol: '0700.HK', name: 'Tencent' },
  { symbol: '9988.HK', name: 'Alibaba' },
  { symbol: '3690.HK', name: 'Meituan' },
  { symbol: '1810.HK', name: 'Xiaomi' },
  { symbol: '0388.HK', name: 'HKEX' },
  { symbol: '0939.HK', name: 'CCB' },
  { symbol: '2318.HK', name: 'Ping An' },
  { symbol: '1299.HK', name: 'AIA' },
  { symbol: '0005.HK', name: 'HSBC' },
  { symbol: '9618.HK', name: 'JD.com' },
  { symbol: 'D05.SG', name: 'DBS' },
  { symbol: 'C31.SG', name: 'CapitaLand' },
  { symbol: 'O39.SG', name: 'OCBC' },
  { symbol: 'U11.SG', name: 'UOB' },
  { symbol: 'Z74.SG', name: 'Singtel' },
]

/**
 * Pure parser for `longbridge watchlist --format json` output — see the
 * universe-source documentation above. Unknown payloads degrade to `[]`
 * (never a crash, never fabricated symbols).
 */
export function universeFromWatchlistGroups(groups: unknown): UniverseEntry[] {
  if (!Array.isArray(groups)) return []
  const entries: UniverseEntry[] = []
  for (const group of groups) {
    if (!isRecord(group)) continue
    const securities = group.securities
    if (!Array.isArray(securities)) continue
    for (const security of securities) {
      if (!isRecord(security)) continue
      const symbol = typeof security.symbol === 'string' ? security.symbol.trim() : ''
      if (symbol === '') continue
      entries.push({
        symbol,
        ...(typeof security.name === 'string' && security.name.trim() !== ''
          ? { name: security.name.trim() }
          : {}),
      })
    }
  }
  return entries
}

export interface ScreeningServiceOptions {
  registry: CapabilityRegistry
  repository: ScreeningRunRepository
  /** Universe hook; defaults to the static pool. */
  universeProvider?: UniverseProvider
  executor?: CapabilityExecutor
  now?: () => number
}

export class ScreeningService {
  private readonly registry: CapabilityRegistry
  private readonly repository: ScreeningRunRepository
  private readonly universeProvider: UniverseProvider
  private readonly executor: CapabilityExecutor
  private readonly now: () => number
  private sequence = 0

  constructor(options: ScreeningServiceOptions) {
    this.registry = options.registry
    this.repository = options.repository
    this.universeProvider = options.universeProvider ?? (async () => STATIC_UNIVERSE)
    this.now = options.now ?? Date.now
    this.executor = options.executor ?? new CapabilityExecutor({ now: this.now })
  }

  async runScreening(query: ScreeningQuery): Promise<ScreeningRun> {
    const strategy = getScreeningStrategy(query.strategy)
    if (!strategy) {
      throw new Error(`Unknown screening strategy "${query.strategy}"`)
    }
    const limit = Math.max(1, Math.floor(query.limit))

    const universe = await this.resolveUniverse(query)
    if (universe.length === 0) {
      const run = this.emptyRun(strategy, query, limit, 'Universe is empty; nothing to screen.')
      await this.repository.saveRun(run)
      return run
    }

    const specs = this.buildSpecs(strategy, universe, query.market)
    const outcomes = await this.executor.runAll(specs, {
      concurrency: CONCURRENCY,
      timeoutMs: TIMEOUT_MS,
    })

    const bySymbol = this.collectData(universe, specs, outcomes)
    const failures = this.collectFailures(strategy, specs, outcomes)

    const candidates: ScreeningCandidate[] = []
    for (const entry of universe) {
      const symbolData = bySymbol.get(entry.symbol)
      if (!symbolData) continue
      const candidate = strategy.compute({
        symbol: entry.symbol,
        data: symbolData,
        market: query.market ?? marketForSymbol(entry.symbol),
        nowSeconds: Math.floor(this.now() / 1000),
      })
      if (candidate) candidates.push(candidate)
    }

    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    const providers = [
      ...new Set(
        outcomes
          .filter((outcome) => outcome.record.status === 'success' && outcome.result)
          .map((outcome) => outcome.result!.provenance.provider)
          .filter((provider): provider is string => typeof provider === 'string')
      ),
    ]

    const run: ScreeningRun = {
      id: this.genId(strategy.id),
      strategy: strategy.id,
      query: {
        universe: query.universe,
        market: query.market,
        filters: query.filters,
        limit,
      },
      providers,
      createdAt: this.now(),
      candidates: candidates.slice(0, limit),
      failures,
    }
    await this.repository.saveRun(run)
    return run
  }

  async listRuns(): Promise<ScreeningRun[]> {
    return this.repository.listRuns()
  }

  async getRun(runId: string): Promise<ScreeningRun | undefined> {
    return this.repository.getRun(runId)
  }

  private async resolveUniverse(query: ScreeningQuery): Promise<UniverseEntry[]> {
    const dedupe = new Map<string, UniverseEntry>()
    if (query.universe && query.universe.length > 0) {
      for (const raw of query.universe) {
        const symbol = raw.trim().toUpperCase()
        if (symbol === '') continue
        dedupe.set(symbol, { symbol })
      }
    } else {
      const entries = await this.universeProvider()
      for (const entry of entries) {
        const symbol = entry.symbol.trim().toUpperCase()
        if (symbol === '') continue
        dedupe.set(symbol, { symbol, ...(entry.name ? { name: entry.name } : {}) })
      }
    }
    return [...dedupe.values()].slice(0, MAX_UNIVERSE)
  }

  private buildSpecs(
    strategy: ScreeningStrategyDef,
    universe: UniverseEntry[],
    market: string | undefined
  ): RunAllSpec[] {
    const specs: RunAllSpec[] = []
    const needed = [...new Set(strategy.capabilityIds)]

    // `research.events` is batched (≤10 symbols per run); everything else is
    // one run per symbol. `market.sentiment` runs once per market.
    const calendarSymbols: string[] = []
    for (const entry of universe) {
      for (const id of needed) {
        if (id === 'research.events') {
          calendarSymbols.push(entry.symbol)
          continue
        }
        if (id === 'market.sentiment') continue
        const cap = this.registry.get(id)
        if (!cap) continue
        specs.push({ cap, input: this.inputFor(id, entry.symbol) })
      }
    }

    if (needed.includes('research.events')) {
      const cap = this.registry.get('research.events')
      if (cap) {
        for (let i = 0; i < calendarSymbols.length; i += CALENDAR_BATCH) {
          specs.push({
            cap,
            input: {
              eventType: 'financial',
              symbols: calendarSymbols.slice(i, i + CALENDAR_BATCH),
              count: CALENDAR_COUNT,
            },
          })
        }
      }
    }

    if (needed.includes('market.sentiment')) {
      const cap = this.registry.get('market.sentiment')
      if (cap) {
        const markets = new Set<string>()
        for (const entry of universe) {
          markets.add(marketForSymbol(entry.symbol))
        }
        for (const marketCode of markets) {
          specs.push({ cap, input: { market: marketCode } })
        }
      }
    }

    return specs
  }

  private inputFor(id: string, symbol: string): Record<string, unknown> {
    if (id === 'market.kline') {
      return { symbol, period: '1d', limit: KLINE_LIMIT }
    }
    return { symbol }
  }

  /**
   * Fold successful runs into per-symbol data bundles. Calendar events are
   * attributed to symbols via `event.symbol` (case-insensitive); events
   * without a symbol cannot be attributed and are dropped (never guessed).
   */
  private collectData(
    universe: UniverseEntry[],
    specs: RunAllSpec[],
    outcomes: RunOutcome[]
  ): Map<string, SymbolData> {
    const bySymbol = new Map<string, SymbolData>()
    const names = new Map(universe.map((entry) => [entry.symbol, entry.name]))
    for (const entry of universe) {
      bySymbol.set(entry.symbol, { symbol: entry.symbol, evidence: [], ...(names.get(entry.symbol) ? { name: names.get(entry.symbol) } : {}) })
    }

    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i]
      const outcome = outcomes[i]
      if (!outcome || outcome.record.status !== 'success' || !outcome.result) continue
      const id = outcome.record.capabilityId
      const data = outcome.result.data

      // RunAllSpec.input is `unknown`; the spec builder in this file owns every
      // input shape, so the casts below are trusted boundary reads.
      if (id === 'research.events') {
        const input = spec.input as { symbols?: string[] }
        const symbols = input.symbols ?? []
        const events = Array.isArray(data) ? data : []
        for (const rawEvent of events) {
          if (!isRecord(rawEvent)) continue
          const eventSymbol = rawEvent.symbol
          if (typeof eventSymbol !== 'string') continue
          const target = normalizeSymbol(eventSymbol)
          if (!symbols.some((symbol) => normalizeSymbol(symbol) === target)) continue
          const bundle = bySymbol.get(target)
          if (!bundle) continue
          const event = rawEvent as unknown as CalendarEvent
          bundle.calendar = [...(bundle.calendar ?? []), event]
          if (!bundle.evidence.includes(outcome.record.id)) bundle.evidence.push(outcome.record.id)
        }
        continue
      }

      if (id === 'market.sentiment') {
        const input = spec.input as { market?: string }
        const market = input.market
        for (const [symbol, bundle] of bySymbol) {
          if (bundle.sentiment) continue
          if (market !== undefined && marketForSymbol(symbol) !== market) continue
          bundle.sentiment = data as SymbolData['sentiment']
        }
        continue
      }

      const input = spec.input as { symbol?: string }
      const symbol = normalizeSymbol(input.symbol ?? '')
      const bundle = bySymbol.get(symbol)
      if (!bundle) continue
      this.attach(bundle, id, data)
      bundle.evidence.push(outcome.record.id)
    }

    return bySymbol
  }

  private attach(bundle: SymbolData, id: string, data: unknown): void {
    switch (id) {
      case 'market.quote':
        bundle.quote = data as SymbolData['quote']
        break
      case 'market.kline':
        bundle.kline = data as SymbolData['kline']
        break
      case 'market.intraday':
        bundle.intraday = data as SymbolData['intraday']
        break
      case 'company.valuation':
        bundle.valuation = data as SymbolData['valuation']
        break
      case 'company.financials':
        if (isRecord(data) && 'statements' in data) {
          bundle.financials = data as unknown as SymbolData['financials']
        } else {
          bundle.normalizedFinancials = data as SymbolData['normalizedFinancials']
        }
        break
      case 'company.ratings':
        bundle.ratings = data as SymbolData['ratings']
        break
      case 'company.dividends':
        bundle.dividends = data as SymbolData['dividends']
        break
      case 'company.earnings':
        bundle.earnings = data as SymbolData['earnings']
        break
      case 'research.news':
        bundle.news = data as SymbolData['news']
        break
      default:
        break
    }
  }

  private collectFailures(
    strategy: ScreeningStrategyDef,
    specs: RunAllSpec[],
    outcomes: RunOutcome[]
  ): Record<string, string> {
    const failures: Record<string, string> = {}
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i]
      const outcome = outcomes[i]
      if (!outcome || outcome.record.status === 'success') continue
      const id = outcome.record.capabilityId
      if (failures[id]) continue
      failures[id] = outcome.record.error ?? `${id} failed`
    }
    // Capabilities the strategy needs but the registry does not have: honest
    // 'unavailable' entries so the UI never implies data that cannot exist.
    for (const id of strategy.capabilityIds) {
      if (this.registry.get(id)) continue
      failures[id] = 'Capability not registered'
    }
    return failures
  }

  private emptyRun(
    strategy: ScreeningStrategyDef,
    query: ScreeningQuery,
    limit: number,
    reason: string
  ): ScreeningRun {
    return {
      id: this.genId(strategy.id),
      strategy: strategy.id,
      query: { universe: query.universe, market: query.market, filters: query.filters, limit },
      providers: [],
      createdAt: this.now(),
      candidates: [],
      failures: { universe: reason },
    }
  }

  private genId(strategyId: string): string {
    this.sequence += 1
    return `screen-${strategyId}-${this.now()}-${this.sequence}`
  }
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}



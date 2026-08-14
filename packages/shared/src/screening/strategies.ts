import type {
  CalcIndex,
  CalendarEvent,
  CapabilityId,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  InstitutionRating,
  IntradayData,
  Kline,
  MarketTemperature,
  NewsItem,
  Quote,
  ScreeningCandidate,
  ScreeningStrategy,
} from '@finagent/core'
import { toFiniteNumber } from '../guards.ts'

/**
 * Discover strategy rules (spec §5) — the 17 deterministic screening tasks.
 *
 * Every rule is a pure function over the structured capability data bundle
 * fetched for ONE symbol (plus an optional market-level sentiment snapshot).
 * Rules never call providers and never fabricate data: when the data a rule
 * needs is missing or the criterion is not met, `compute` returns `null` and
 * the symbol is skipped. Scoring is a deterministic 0..1 rank; a rule that is
 * genuinely binary (pattern present or not) omits `score` entirely.
 *
 * The data bundle is typed from the provider-neutral core shapes; financial
 * statements additionally honor the normalized top-level contract used by the
 * compare module (`{ roe, revenueGrowth, grossMargin, netMargin }`), which the
 * Longbridge expansion aligns to. When the normalized fields are absent, the
 * extractor digs the live `FinancialReport` statement accounts (`ROE`,
 * `OperatingRevenue` + `yoy`, `GrossMgn`, `NetProfitMargin` — the field codes
 * the Longbridge CLI emits).
 *
 * Threshold constants below are the deterministic tuning of each rule; they
 * are exported so tests pin them and future tuning is a single edit.
 */

export type StrategyFamily = 'market-movers' | 'fundamental' | 'technical' | 'events'

/** Deterministic tuning constants (percent where noted). */
export const MIN_DAY_MOVE_PCT = 1 // top-gainers / top-losers inclusion bar
export const HIGH_VOLUME_RATIO = 1.5 // high-volume: vs baseline volume
export const UNUSUAL_AMPLITUDE_RATIO = 1.5 // unusual-movement: today vs 20d avg
export const UNUSUAL_AMPLITUDE_MIN_PCT = 2
export const LOW_PE = 15 // low-valuation
export const LOW_PB = 1.2
export const HIGH_ROE_PCT = 15 // high-roe
export const REVENUE_GROWTH_PCT = 10 // revenue-growth
export const DIVIDEND_YIELD_PCT = 3 // high-dividend (dpsRate is percent)
export const QUALITY_ROE_PCT = 15 // quality-growth
export const QUALITY_MARGIN_PCT = 10
export const QUALITY_GROWTH_PCT = 5
export const MOMENTUM_1M_PCT = 5 // strong-momentum
export const MOMENTUM_3M_PCT = 10
export const BREAKOUT_WINDOW = 20 // breakout: prior bars to beat
export const BREAKOUT_VOLUME_MULT = 1.5
export const OVERSOLD_BELOW_SMA_PCT = 8 // oversold: close below 20d SMA
export const OVERSOLD_3M_PCT = -10
export const EARNINGS_WINDOW_DAYS = 30 // upcoming-earnings
export const RATING_UPSIDE_MIN_PCT = 5 // rating-changes
export const NEWS_SURGE_MIN = 3 // news-surge: items in the last 7 days
export const NEWS_SURGE_WINDOW_DAYS = 7
export const DIVIDEND_WINDOW_DAYS = 90 // dividend-events

/** One strategy's view of the fetched data for a single symbol. */
export interface SymbolData {
  symbol: string
  name?: string
  quote?: Quote
  kline?: Kline[]
  intraday?: IntradayData[]
  valuation?: CalcIndex
  financials?: FinancialReport
  /** Normalized financial contract (compare §contract) — preferred when present. */
  normalizedFinancials?: FinancialMetrics
  ratings?: InstitutionRating
  dividends?: DividendRecord[]
  earnings?: EpsForecast[]
  /** Calendar events attributed to this symbol (event.symbol match). */
  calendar?: CalendarEvent[]
  news?: NewsItem[]
  /** Market-level sentiment snapshot (fetched once per market). */
  sentiment?: MarketTemperature
  /** Capability-run ids backing this symbol's data (evidence trail). */
  evidence: string[]
}

/** Normalized financial contract shared with the compare module. */
export interface FinancialMetrics {
  roe?: number
  revenueGrowth?: number
  grossMargin?: number
  netMargin?: number
}

export interface StrategyContext {
  symbol: string
  data: SymbolData
  market?: string
  /** Epoch SECONDS — injected so rules are deterministic in tests. */
  nowSeconds: number
}

export interface ScreeningStrategyDef {
  id: ScreeningStrategy
  title: string
  description: string
  family: StrategyFamily
  /** Capability ids the rule needs (all must be real registry ids). */
  capabilityIds: CapabilityId[]
  /** Deterministic rule; null → symbol skipped. */
  compute(ctx: StrategyContext): ScreeningCandidate | null
}

// ── data extractors ─────────────────────────────────────────────────────────

/** Daily closes, oldest first, defensive against unordered provider output. */
function sortedCloses(kline: Kline[] | undefined): number[] {
  if (!kline) return []
  return [...kline]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((bar) => toFiniteNumber(bar.close))
    .filter((value): value is number => value !== undefined)
}

function sma(values: number[], window: number): number | undefined {
  if (values.length < window) return undefined
  const slice = values.slice(-window)
  const sum = slice.reduce((acc, value) => acc + value, 0)
  return sum / window
}

/** Percent price change over the trailing `bars` closes (undefined when short). */
function pctReturn(values: number[], bars: number): number | undefined {
  if (values.length <= bars) return undefined
  const latest = values[values.length - 1]
  const base = values[values.length - 1 - bars]
  if (base === undefined || base === 0) return undefined
  return ((latest - base) / base) * 100
}

/** Clamp a normalized score into 0..1. */
function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function fmtPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

interface ReportAccountValue {
  value?: number
  yoy?: number
}

interface ReportAccount {
  field: string
  values: ReportAccountValue[]
}

function statementAccounts(report: FinancialReport | undefined, kind: 'IS' | 'BS' | 'CF'): ReportAccount[] {
  const statement = report?.statements?.[kind]
  const accounts: ReportAccount[] = []
  for (const indicator of statement?.indicators ?? []) {
    for (const account of indicator.accounts ?? []) {
      const values: ReportAccountValue[] = []
      for (const entry of account.values ?? []) {
        const value = toFiniteNumber(entry.value)
        const yoy = toFiniteNumber(entry.yoy)
        values.push({ ...(value !== undefined ? { value } : {}), ...(yoy !== undefined ? { yoy } : {}) })
      }
      accounts.push({ field: account.field, values })
    }
  }
  return accounts
}

function latestAccountValue(accounts: ReportAccount[], field: string): number | undefined {
  const account = accounts.find((entry) => entry.field === field)
  if (!account) return undefined
  return account.values[0]?.value ?? account.values[account.values.length - 1]?.value
}

function latestAccountYoy(accounts: ReportAccount[], field: string): number | undefined {
  const account = accounts.find((entry) => entry.field === field)
  if (!account) return undefined
  const latest = account.values[0]
  if (latest?.yoy !== undefined) return latest.yoy
  // yoy missing on the newest period → compute from the two most recent values.
  const [newest, previous] = account.values
  if (newest?.value !== undefined && previous?.value !== undefined && previous.value !== 0) {
    return ((newest.value - previous.value) / previous.value) * 100
  }
  return undefined
}

/** ROE / revenue growth / margins from the normalized contract or the live statement. */
export function extractFinancialMetrics(data: SymbolData): FinancialMetrics {
  const normalized = data.normalizedFinancials
  if (normalized) return normalized
  const accounts = statementAccounts(data.financials, 'IS')
  return {
    roe: latestAccountValue(accounts, 'ROE'),
    revenueGrowth: latestAccountYoy(accounts, 'OperatingRevenue'),
    grossMargin: latestAccountValue(accounts, 'GrossMgn'),
    netMargin: latestAccountValue(accounts, 'NetProfitMargin'),
  }
}

// ── candidates ──────────────────────────────────────────────────────────────

function candidate(
  ctx: StrategyContext,
  partial: {
    score?: number
    reasons: string[]
    metrics: Record<string, string | number | undefined>
  }
): ScreeningCandidate {
  const { data } = ctx
  return {
    symbol: ctx.symbol,
    name: data.name ?? '',
    ...(ctx.market ? { market: ctx.market } : {}),
    ...(partial.score !== undefined ? { score: partial.score } : {}),
    reasons: partial.reasons,
    metrics: partial.metrics,
    evidence: data.evidence,
  }
}

// ── the 17 rules ────────────────────────────────────────────────────────────

const topGainers: ScreeningStrategyDef = {
  id: 'top-gainers',
  title: 'Top Gainers',
  description: 'Biggest single-day price gains in the universe.',
  family: 'market-movers',
  capabilityIds: ['market.quote'],
  compute(ctx) {
    const changePercent = toFiniteNumber(ctx.data.quote?.changePercent)
    if (changePercent === undefined || changePercent < MIN_DAY_MOVE_PCT) return null
    const lastPrice = toFiniteNumber(ctx.data.quote?.lastPrice)
    return candidate(ctx, {
      score: clamp01(changePercent / 10),
      reasons: [`Day change ${fmtPct(changePercent)}`],
      metrics: {
        changePercent,
        lastPrice,
        volume: toFiniteNumber(ctx.data.quote?.volume),
      },
    })
  },
}

const topLosers: ScreeningStrategyDef = {
  id: 'top-losers',
  title: 'Top Losers',
  description: 'Biggest single-day price declines in the universe.',
  family: 'market-movers',
  capabilityIds: ['market.quote'],
  compute(ctx) {
    const changePercent = toFiniteNumber(ctx.data.quote?.changePercent)
    if (changePercent === undefined || changePercent > -MIN_DAY_MOVE_PCT) return null
    const lastPrice = toFiniteNumber(ctx.data.quote?.lastPrice)
    return candidate(ctx, {
      score: clamp01(-changePercent / 10),
      reasons: [`Day change ${fmtPct(changePercent)}`],
      metrics: {
        changePercent,
        lastPrice,
        volume: toFiniteNumber(ctx.data.quote?.volume),
      },
    })
  },
}

const highVolume: ScreeningStrategyDef = {
  id: 'high-volume',
  title: 'High Volume',
  description: 'Unusual trading volume versus each stock\u2019s recent baseline.',
  family: 'market-movers',
  capabilityIds: ['market.quote', 'company.valuation', 'market.kline'],
  compute(ctx) {
    // Baseline ratio: CalcIndex.volumeRatio (vs 5-day average) is preferred;
    // kline-derived today-vs-20d average is the fallback.
    const volumeRatio = toFiniteNumber(ctx.data.valuation?.volumeRatio)
    const closes = sortedCloses(ctx.data.kline)
    const barVolumes = ctx.data.kline
      ? [...ctx.data.kline].sort((a, b) => a.timestamp - b.timestamp).map((bar) => toFiniteNumber(bar.volume))
      : []
    const klineRatio = (() => {
      const finite = barVolumes.filter((value): value is number => value !== undefined)
      if (finite.length <= BREAKOUT_WINDOW) return undefined
      const today = finite[finite.length - 1]
      const baseline = finite.slice(-BREAKOUT_WINDOW - 1, -1)
      const avg = baseline.reduce((acc, value) => acc + value, 0) / baseline.length
      if (avg === 0) return undefined
      return today / avg
    })()

    const ratio = volumeRatio ?? klineRatio
    if (ratio === undefined || ratio < HIGH_VOLUME_RATIO) return null
    const source = volumeRatio !== undefined ? '5d average' : '20d average'
    const reasons = [`Volume ratio ${ratio.toFixed(2)}x vs ${source}`]
    if (closes.length > 0) {
      const fiveDay = pctReturn(closes, 5)
      if (fiveDay !== undefined) reasons.push(`5d return ${fmtPct(fiveDay)}`)
    }
    return candidate(ctx, {
      score: clamp01((ratio - 1) / 2),
      reasons,
      metrics: {
        volumeRatio,
        volume: toFiniteNumber(ctx.data.quote?.volume),
        klineVolumeRatio: klineRatio,
      },
    })
  },
}

const unusualMovement: ScreeningStrategyDef = {
  id: 'unusual-movement',
  title: 'Unusual Movement',
  description: 'Price amplitude well beyond each stock\u2019s recent range.',
  family: 'market-movers',
  capabilityIds: ['market.kline', 'company.valuation', 'market.sentiment'],
  compute(ctx) {
    const bars = ctx.data.kline
      ? [...ctx.data.kline].sort((a, b) => a.timestamp - b.timestamp)
      : []
    if (bars.length <= BREAKOUT_WINDOW) return null
    const amplitudeOf = (bar: Kline): number | undefined => {
      const high = toFiniteNumber(bar.high)
      const low = toFiniteNumber(bar.low)
      const prevClose = toFiniteNumber(bar.close) // latest close proxies prev close for the prior bars
      if (high === undefined || low === undefined || prevClose === undefined || prevClose === 0) return undefined
      return ((high - low) / prevClose) * 100
    }
    const latest = bars[bars.length - 1]
    const today = toFiniteNumber(ctx.data.valuation?.amplitude) ?? amplitudeOf(latest)
    if (today === undefined || today < UNUSUAL_AMPLITUDE_MIN_PCT) return null
    const prior = bars.slice(-BREAKOUT_WINDOW - 1, -1)
    const amplitudes = prior
      .map(amplitudeOf)
      .filter((value): value is number => value !== undefined)
    if (amplitudes.length === 0) return null
    const avg = amplitudes.reduce((acc, value) => acc + value, 0) / amplitudes.length
    if (avg === 0) return null
    const ratio = today / avg
    if (ratio < UNUSUAL_AMPLITUDE_RATIO) return null

    const reasons = [`Amplitude ${today.toFixed(1)}% vs ${avg.toFixed(1)}% 20d avg`]
    const sentiment = ctx.data.sentiment
    if (sentiment) {
      reasons.push(`Market temp ${toFiniteNumber(sentiment.temperature)?.toFixed(0) ?? '?'}/100 (${sentiment.description})`)
    }
    return candidate(ctx, {
      score: clamp01(ratio - 1),
      reasons,
      metrics: { amplitude: today, averageAmplitude: avg, ratio },
    })
  },
}

const lowValuation: ScreeningStrategyDef = {
  id: 'low-valuation',
  title: 'Low Valuation',
  description: 'Cheap on price-to-earnings and/or price-to-book.',
  family: 'fundamental',
  capabilityIds: ['company.valuation'],
  compute(ctx) {
    const pe = toFiniteNumber(ctx.data.valuation?.pe)
    const pb = toFiniteNumber(ctx.data.valuation?.pb)
    if (pe === undefined && pb === undefined) return null
    const cheapPe = pe !== undefined && pe > 0 && pe < LOW_PE
    const cheapPb = pb !== undefined && pb > 0 && pb < LOW_PB
    if (!cheapPe && !cheapPb) return null

    const reasons: string[] = []
    if (cheapPe) reasons.push(`PE ${pe!.toFixed(1)}`)
    if (cheapPb) reasons.push(`PB ${pb!.toFixed(2)}`)
    const peScore = pe !== undefined && pe > 0 ? clamp01((22.5 - pe) / 22.5) : 0
    const pbScore = pb !== undefined && pb > 0 ? clamp01((3 - pb) / 3) : 0
    return candidate(ctx, {
      score: Math.max(peScore, pbScore),
      reasons,
      metrics: { pe, pb, totalMarketValue: toFiniteNumber(ctx.data.valuation?.totalMarketValue) },
    })
  },
}

const highRoe: ScreeningStrategyDef = {
  id: 'high-roe',
  title: 'High ROE',
  description: 'Efficient capital use — return on equity above the bar.',
  family: 'fundamental',
  capabilityIds: ['company.financials'],
  compute(ctx) {
    const roe = extractFinancialMetrics(ctx.data).roe
    if (roe === undefined || roe < HIGH_ROE_PCT) return null
    return candidate(ctx, {
      score: clamp01(roe / 30),
      reasons: [`ROE ${roe.toFixed(1)}%`],
      metrics: { roe },
    })
  },
}

const revenueGrowth: ScreeningStrategyDef = {
  id: 'revenue-growth',
  title: 'Revenue Growth',
  description: 'Top-line growth — latest reported YoY revenue increase.',
  family: 'fundamental',
  capabilityIds: ['company.financials'],
  compute(ctx) {
    const growth = extractFinancialMetrics(ctx.data).revenueGrowth
    if (growth === undefined || growth < REVENUE_GROWTH_PCT) return null
    return candidate(ctx, {
      score: clamp01(growth / 40),
      reasons: [`Revenue growth ${fmtPct(growth)} YoY`],
      metrics: { revenueGrowth: growth },
    })
  },
}

const highDividend: ScreeningStrategyDef = {
  id: 'high-dividend',
  title: 'High Dividend',
  description: 'Attractive dividend yield with a real payment history.',
  family: 'fundamental',
  capabilityIds: ['company.valuation', 'company.dividends'],
  compute(ctx) {
    const dpsRate = toFiniteNumber(ctx.data.valuation?.dpsRate)
    if (dpsRate === undefined || dpsRate < DIVIDEND_YIELD_PCT) return null
    const records = ctx.data.dividends ?? []
    const reasons = [`Dividend yield ${dpsRate.toFixed(2)}%`]
    if (records.length > 0) reasons.push(`${records.length} payments on record`)
    return candidate(ctx, {
      score: clamp01(dpsRate / 8),
      reasons,
      metrics: { dpsRate, paymentRecords: records.length },
    })
  },
}

const qualityGrowth: ScreeningStrategyDef = {
  id: 'quality-growth',
  title: 'Quality Growth',
  description: 'Growth that is profitable — ROE, margin and revenue together.',
  family: 'fundamental',
  capabilityIds: ['company.financials'],
  compute(ctx) {
    const metrics = extractFinancialMetrics(ctx.data)
    const { roe, revenueGrowth: growth, netMargin } = metrics
    if (roe === undefined || growth === undefined || netMargin === undefined) return null
    if (roe < QUALITY_ROE_PCT || netMargin < QUALITY_MARGIN_PCT || growth < QUALITY_GROWTH_PCT) return null
    const score = clamp01((roe / 30 + growth / 40 + netMargin / 20) / 3)
    return candidate(ctx, {
      score,
      reasons: [
        `ROE ${roe.toFixed(1)}%`,
        `Net margin ${netMargin.toFixed(1)}%`,
        `Revenue growth ${fmtPct(growth)} YoY`,
      ],
      metrics: { roe, netMargin, revenueGrowth: growth },
    })
  },
}

const strongMomentum: ScreeningStrategyDef = {
  id: 'strong-momentum',
  title: 'Strong Momentum',
  description: 'Sustained upside — strong 1m and 3m returns.',
  family: 'technical',
  capabilityIds: ['market.kline'],
  compute(ctx) {
    const closes = sortedCloses(ctx.data.kline)
    const return1m = pctReturn(closes, 21)
    const return3m = pctReturn(closes, 63)
    if (return1m === undefined || return3m === undefined) return null
    if (return1m < MOMENTUM_1M_PCT || return3m < MOMENTUM_3M_PCT) return null
    const score = clamp01((return1m / 20 + return3m / 60) / 2)
    return candidate(ctx, {
      score,
      reasons: [`1m return ${fmtPct(return1m)}`, `3m return ${fmtPct(return3m)}`],
      metrics: { return1m, return3m },
    })
  },
}

const breakout: ScreeningStrategyDef = {
  id: 'breakout',
  title: 'Breakout',
  description: 'New highs on expanding volume.',
  family: 'technical',
  capabilityIds: ['market.kline'],
  compute(ctx) {
    const bars = ctx.data.kline
      ? [...ctx.data.kline].sort((a, b) => a.timestamp - b.timestamp)
      : []
    if (bars.length <= BREAKOUT_WINDOW) return null
    const latest = bars[bars.length - 1]
    const latestClose = toFiniteNumber(latest.close)
    if (latestClose === undefined) return null
    const prior = bars.slice(-BREAKOUT_WINDOW - 1, -1)
    const priorHigh = Math.max(
      ...prior.map((bar) => toFiniteNumber(bar.high)).filter((v): v is number => v !== undefined)
    )
    if (!Number.isFinite(priorHigh) || latestClose <= priorHigh) return null
    const priorVolumes = prior
      .map((bar) => toFiniteNumber(bar.volume))
      .filter((v): v is number => v !== undefined)
    const avgVolume = priorVolumes.length > 0
      ? priorVolumes.reduce((acc, value) => acc + value, 0) / priorVolumes.length
      : 0
    const latestVolume = toFiniteNumber(latest.volume)
    if (avgVolume === 0 || latestVolume === undefined || latestVolume < avgVolume * BREAKOUT_VOLUME_MULT) {
      return null
    }
    const volumeRatio = latestVolume / avgVolume
    return candidate(ctx, {
      score: clamp01(volumeRatio / 3),
      reasons: [
        `Close ${fmtPct(((latestClose - priorHigh) / priorHigh) * 100)} above ${BREAKOUT_WINDOW}d high`,
        `Volume ${volumeRatio.toFixed(2)}x average`,
      ],
      metrics: { close: latestClose, priorHigh, volumeRatio },
    })
  },
}

const oversold: ScreeningStrategyDef = {
  id: 'oversold',
  title: 'Oversold',
  description: 'Deep pullback — price well below its short-term average.',
  family: 'technical',
  capabilityIds: ['market.kline'],
  compute(ctx) {
    const closes = sortedCloses(ctx.data.kline)
    const average20 = sma(closes, 20)
    const latest = closes[closes.length - 1]
    const return3m = pctReturn(closes, 63)
    if (average20 === undefined || latest === undefined || return3m === undefined) return null
    const belowPct = ((latest - average20) / average20) * 100
    if (belowPct > -OVERSOLD_BELOW_SMA_PCT || return3m > OVERSOLD_3M_PCT) return null
    return candidate(ctx, {
      score: clamp01((-belowPct - OVERSOLD_BELOW_SMA_PCT) / 20),
      reasons: [
        `Close ${belowPct.toFixed(1)}% below 20d average`,
        `3m return ${fmtPct(return3m)}`,
      ],
      metrics: { belowSmaPct: belowPct, return3m },
    })
  },
}

const trendReversal: ScreeningStrategyDef = {
  id: 'trend-reversal',
  title: 'Trend Reversal',
  description: 'Downtrend showing its first sign of turning up.',
  family: 'technical',
  capabilityIds: ['market.kline'],
  compute(ctx) {
    const closes = sortedCloses(ctx.data.kline)
    const return3m = pctReturn(closes, 63)
    const return5d = pctReturn(closes, 5)
    const average5 = sma(closes, 5)
    const latest = closes[closes.length - 1]
    if (return3m === undefined || return5d === undefined || average5 === undefined || latest === undefined) {
      return null
    }
    if (return3m >= 0 || return5d <= 0 || latest <= average5) return null
    // Binary rule: the reversal pattern is present or not — no score.
    return candidate(ctx, {
      reasons: [`3m decline ${fmtPct(return3m)}, now ${fmtPct(return5d)} over 5d`],
      metrics: { return3m, return5d },
    })
  },
}

const upcomingEarnings: ScreeningStrategyDef = {
  id: 'upcoming-earnings',
  title: 'Upcoming Earnings',
  description: 'Earnings announcements inside the next 30 days.',
  family: 'events',
  capabilityIds: ['research.events'],
  compute(ctx) {
    const events = (ctx.data.calendar ?? []).filter(
      (event) => event.type?.toLowerCase() === 'financial'
    )
    if (events.length === 0) return null
    const horizon = ctx.nowSeconds + EARNINGS_WINDOW_DAYS * 86_400
    const upcoming = events
      .filter((event) => event.date >= ctx.nowSeconds && event.date <= horizon)
      .sort((a, b) => a.date - b.date)
    if (upcoming.length === 0) return null
    const next = upcoming[0]
    const daysUntil = Math.max(0, Math.ceil((next.date - ctx.nowSeconds) / 86_400))
    return candidate(ctx, {
      score: clamp01(1 - daysUntil / EARNINGS_WINDOW_DAYS),
      reasons: [`Earnings in ${daysUntil}d (${new Date(next.date * 1000).toISOString().slice(0, 10)})`],
      metrics: { daysUntil, date: next.date },
    })
  },
}

const ratingChanges: ScreeningStrategyDef = {
  id: 'rating-changes',
  title: 'Rating Changes',
  description: 'Buy-consensus names with meaningful analyst upside.',
  family: 'events',
  capabilityIds: ['company.ratings', 'market.quote'],
  compute(ctx) {
    const rating = ctx.data.ratings
    const recommend = rating?.recommend?.toLowerCase() ?? ''
    if (recommend !== 'strong_buy' && recommend !== 'buy') return null
    const target = toFiniteNumber(rating?.target)
    const lastPrice = toFiniteNumber(ctx.data.quote?.lastPrice)
    if (target === undefined || lastPrice === undefined || lastPrice <= 0) return null
    const upside = ((target - lastPrice) / lastPrice) * 100
    if (upside < RATING_UPSIDE_MIN_PCT) return null

    const reasons = [`Consensus ${recommend.replace('_', ' ')}`]
    const changeCount = toFiniteNumber(rating?.institutional?.change)
    if (changeCount !== undefined && changeCount > 0) {
      reasons.push(`${changeCount} institution${changeCount === 1 ? '' : 's'} changed rating`)
    }
    reasons.push(`Target upside ${fmtPct(upside)}`)
    return candidate(ctx, {
      score: clamp01(upside / 40),
      reasons,
      metrics: { upside, target, lastPrice },
    })
  },
}

const newsSurge: ScreeningStrategyDef = {
  id: 'news-surge',
  title: 'News Surge',
  description: 'A burst of recent headlines — a stock in the news.',
  family: 'events',
  capabilityIds: ['research.news'],
  compute(ctx) {
    const items = ctx.data.news ?? []
    if (items.length === 0) return null
    const cutoff = ctx.nowSeconds - NEWS_SURGE_WINDOW_DAYS * 86_400
    const fresh = items.filter((item) => item.timestamp >= cutoff)
    if (fresh.length < NEWS_SURGE_MIN) return null
    const score = clamp01(fresh.length / 10)
    const newest = fresh[0]
    return candidate(ctx, {
      score,
      reasons: [`${fresh.length} headlines in ${NEWS_SURGE_WINDOW_DAYS}d`],
      metrics: { headlineCount: fresh.length, newestTimestamp: newest?.timestamp },
    })
  },
}

const dividendEvents: ScreeningStrategyDef = {
  id: 'dividend-events',
  title: 'Dividend Events',
  description: 'Ex-dividend dates arriving within the next 90 days.',
  family: 'events',
  capabilityIds: ['company.dividends'],
  compute(ctx) {
    const records = ctx.data.dividends ?? []
    const horizon = ctx.nowSeconds + DIVIDEND_WINDOW_DAYS * 86_400
    const upcoming = records
      .filter((record) => record.exDate >= ctx.nowSeconds && record.exDate <= horizon)
      .sort((a, b) => a.exDate - b.exDate)
    if (upcoming.length === 0) return null
    const next = upcoming[0]
    const daysUntil = Math.max(0, Math.ceil((next.exDate - ctx.nowSeconds) / 86_400))
    return candidate(ctx, {
      score: clamp01(1 - daysUntil / DIVIDEND_WINDOW_DAYS),
      reasons: [`Ex-dividend in ${daysUntil}d (${new Date(next.exDate * 1000).toISOString().slice(0, 10)})`],
      metrics: { daysUntil, exDate: next.exDate },
    })
  },
}

/** All 17 tasks in stable order (spec §5). */
export const SCREENING_STRATEGIES: ScreeningStrategyDef[] = [
  topGainers,
  topLosers,
  highVolume,
  unusualMovement,
  lowValuation,
  highRoe,
  revenueGrowth,
  highDividend,
  qualityGrowth,
  strongMomentum,
  breakout,
  oversold,
  trendReversal,
  upcomingEarnings,
  ratingChanges,
  newsSurge,
  dividendEvents,
]

const byId = Object.fromEntries(
  SCREENING_STRATEGIES.map((strategy) => [strategy.id, strategy])
) as Record<ScreeningStrategy, ScreeningStrategyDef>

export function getScreeningStrategy(id: ScreeningStrategy): ScreeningStrategyDef | undefined {
  return byId[id]
}

export function strategiesByFamily(family: StrategyFamily): ScreeningStrategyDef[] {
  return SCREENING_STRATEGIES.filter((strategy) => strategy.family === family)
}

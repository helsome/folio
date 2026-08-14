import { randomUUID } from 'node:crypto'
import type {
  AutomationRule,
  AutomationRun,
  CalendarEvent,
  CapabilityRegistry,
  NotificationEvent,
  Quote,
  ResearchDiff,
  StrategyId,
} from '@finagent/core'
import { MATERIAL_PRICE_MOVE_PCT } from '../research-diff/materiality.ts'
import type { ResearchDiffRepository } from '../research-diff/repository.ts'

/**
 * The automation executor (spec §21–25).
 *
 * Per rule, the runner resolves the scope, then for every symbol performs a
 * LIGHTWEIGHT refresh (quote via `market.quote`, latest research diff, and —
 * when the capability is registered — a calendar probe for fresh earnings).
 * Only symbols that cross the materiality bar get the expensive
 * `researchStart` analysis; non-material symbols are NEVER researched.
 *
 * Notifications are dispatched through the injected `notify` callback (the
 * kernel host wires OS + in-app); the main process never appears here — this
 * module is pure shared code. The caller persists the returned
 * `AutomationRun` via `AutomationRunRepository`.
 */

/** Per-symbol materiality signals, first version (core §25). */
export interface MaterialSignals {
  /** Abs change % vs previous close. */
  priceMovePct?: number
  /** Latest research diff carries the material flag. */
  diffMaterial: boolean
  /** A material analyst-rating change in the latest diff. */
  ratingChanged: boolean
  /** Fresh earnings: new earnings section in the diff, or a calendar event. */
  earningsAnnounced: boolean
}

/** True when any signal crosses the materiality bar. */
export function signalsAreMaterial(signals: MaterialSignals): boolean {
  if (signals.diffMaterial || signals.ratingChanged || signals.earningsAnnounced) return true
  return (
    signals.priceMovePct !== undefined && signals.priceMovePct >= MATERIAL_PRICE_MOVE_PCT
  )
}

export interface AutomationRunContext {
  /** Capability registry — `market.quote` refresh + optional probes. */
  registry: CapabilityRegistry
  /** Latest research diff per symbol. */
  diffRepo: ResearchDiffRepository
  /** Expensive analysis for material symbols only (research service bridge). */
  researchStart: (symbol: string, strategyId?: StrategyId) => Promise<unknown>
  /** Scope providers — the kernel host wires these (UI atoms / stored scope). */
  watchlistSymbols?: () => string[] | Promise<string[]>
  portfolioSymbols?: () => string[] | Promise<string[]>
  thesisSymbols?: () => string[] | Promise<string[]>
  /** Earnings-event hook scope for pre/post-earnings rules. */
  symbols?: string[]
  /** Notification dispatcher (kernel host: OS notification + in-app). */
  notify?: (event: NotificationEvent) => void | Promise<void>
  idGen?: () => string
  now?: () => number
}

/** Execute one automation rule; returns the run for the caller to persist. */
export async function runAutomation(
  rule: AutomationRule,
  ctx: AutomationRunContext
): Promise<AutomationRun> {
  const ranAt = ctx.now?.() ?? Date.now()
  const id = ctx.idGen?.() ?? randomUUID()
  const symbols = await resolveScope(rule, ctx)

  const failures: string[] = []
  if (symbols.length === 0) {
    failures.push(`no symbols in scope for ${rule.type}`)
  }

  let evaluated = 0
  let materialChanges = 0
  let analyzed = 0
  let notified = false

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase()
    const outcome = await evaluateSymbol(symbol, ctx)
    if (outcome === null) {
      failures.push(`${symbol}: quote unavailable`)
      continue
    }
    evaluated += 1
    const material = signalsAreMaterial(outcome.signals)
    if (material) {
      materialChanges += 1
      analyzed += 1
      await ctx.researchStart(symbol, rule.strategyId)
    }
    if (rule.notify === 'all' || material) {
      await ctx.notify?.(notificationFor(rule, symbol, material, outcome.signals, ranAt))
      notified = true
    }
  }

  return {
    id,
    ruleId: rule.id,
    ranAt,
    evaluated,
    materialChanges,
    analyzed,
    notified,
    failures,
  }
}

/** Symbols the rule monitors: rule override → hook scope → type providers. */
async function resolveScope(rule: AutomationRule, ctx: AutomationRunContext): Promise<string[]> {
  if (rule.symbols !== undefined && rule.symbols.length > 0) return rule.symbols
  if (ctx.symbols !== undefined && ctx.symbols.length > 0) return ctx.symbols
  switch (rule.type) {
    case 'watchlist-daily-review':
      return (await ctx.watchlistSymbols?.()) ?? []
    case 'portfolio-daily-brief':
      return (await ctx.portfolioSymbols?.()) ?? []
    case 'weekly-thesis-review':
      return (await ctx.thesisSymbols?.()) ?? []
    default:
      return []
  }
}

/**
 * Lightweight refresh for one symbol. Returns null (symbol skipped) only when
 * the quote itself is unavailable; optional probes degrade to no-signal.
 */
async function evaluateSymbol(
  symbol: string,
  ctx: AutomationRunContext
): Promise<{ signals: MaterialSignals; quote: Quote } | null> {
  const quote = await fetchQuote(symbol, ctx)
  if (quote === null) return null
  const diff = await ctx.diffRepo.getBySymbol(symbol)
  const signals: MaterialSignals = {
    priceMovePct: priceMovePct(quote),
    diffMaterial: diff?.material === true,
    ratingChanged: hasMaterialRatingChange(diff),
    earningsAnnounced:
      hasNewEarnings(diff) || (await calendarProbe(symbol, ctx)),
  }
  return { signals, quote }
}

async function fetchQuote(symbol: string, ctx: AutomationRunContext): Promise<Quote | null> {
  const cap = ctx.registry.get('market.quote')
  if (!cap) return null
  try {
    const result = await cap.execute({ symbol }, { now: ctx.now })
    return result.data as Quote
  } catch {
    return null
  }
}

/**
 * Calendar probe: a `report`/`financial` event dated on/before today means an
 * earnings announcement the research diff may not cover yet. Degrades to
 * no-signal when the capability is absent or the call fails.
 */
async function calendarProbe(symbol: string, ctx: AutomationRunContext): Promise<boolean> {
  const cap = ctx.registry.get('research.events')
  if (!cap) return false
  try {
    const result = await cap.execute(
      { eventType: 'report', symbols: [symbol], count: 5 },
      { now: ctx.now }
    )
    const events = result.data as CalendarEvent[]
    const nowSeconds = (ctx.now?.() ?? Date.now()) / 1000
    return events.some(
      (event) => (event.type === 'report' || event.type === 'financial') && event.date <= nowSeconds
    )
  } catch {
    return false
  }
}

/** Abs percent move vs previous close; undefined when prevClose is unusable. */
function priceMovePct(quote: Quote): number | undefined {
  const prevClose = quote.prevClose
  if (!Number.isFinite(prevClose) || prevClose <= 0) return undefined
  return (Math.abs(quote.lastPrice - prevClose) / prevClose) * 100
}

function hasMaterialRatingChange(diff: ResearchDiff | undefined): boolean {
  return (
    diff?.changes.some((change) => change.category === 'analyst-rating' && change.material) ===
    true
  )
}

function hasNewEarnings(diff: ResearchDiff | undefined): boolean {
  return (
    diff?.changes.some(
      (change) => change.category === 'earnings' && change.direction === 'new'
    ) === true
  )
}

function notificationFor(
  rule: AutomationRule,
  symbol: string,
  material: boolean,
  signals: MaterialSignals,
  at: number
): NotificationEvent {
  const move = signals.priceMovePct
  const moveText = move !== undefined ? ` (${move.toFixed(1)}% move)` : ''
  const title = material
    ? `${symbol} material change${moveText}`
    : `${symbol} reviewed — no material change`
  const message = material
    ? `${rule.type} flagged a material change: ${describeSignals(signals)}`
    : `Lightweight refresh found nothing above the materiality bar (${rule.type}).`
  return {
    id: `automation-${rule.id}-${symbol}-${at}`,
    source: 'automation',
    severity: material ? 'warning' : 'info',
    symbol,
    title,
    message,
    at,
    payload: { ruleId: rule.id, ruleType: rule.type, ...signals },
  }
}

/** Deterministic human-readable list of which signals fired. */
function describeSignals(signals: MaterialSignals): string {
  const parts: string[] = []
  if (signals.priceMovePct !== undefined && signals.priceMovePct >= MATERIAL_PRICE_MOVE_PCT) {
    parts.push(`price moved ${signals.priceMovePct.toFixed(1)}%`)
  }
  if (signals.diffMaterial) parts.push('research diff flagged material')
  if (signals.ratingChanged) parts.push('analyst rating change')
  if (signals.earningsAnnounced) parts.push('earnings announced')
  return parts.length > 0 ? parts.join(', ') : 'signal threshold crossed'
}

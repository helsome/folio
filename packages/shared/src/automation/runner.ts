import { randomUUID } from 'node:crypto'
import type {
  AutomationRule,
  AutomationRun,
  AutomationScopeKind,
  AutomationScopeSnapshot,
  CalendarEvent,
  CapabilityRegistry,
  NotificationEvent,
  Quote,
  ResearchDiff,
  StrategyId,
} from '@finagent/core'
import { MATERIAL_PRICE_MOVE_PCT } from '../research-diff/materiality.ts'
import type { ResearchDiffRepository } from '../research-diff/repository.ts'
import { AUTOMATION_TYPE_KEYS } from './notifications.ts'
import { createSyncI18n, type SupportedLocale } from '@finagent/i18n'

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
  // Number.isFinite also rejects NaN produced by dirty quotes — a NaN move
  // must read as "no usable signal", never as a crossed bar (issue #185).
  return (
    signals.priceMovePct !== undefined &&
    Number.isFinite(signals.priceMovePct) &&
    signals.priceMovePct >= MATERIAL_PRICE_MOVE_PCT
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
  /** A portfolio scope plus the timestamp of the source snapshot it came from. */
  portfolioSnapshot?: () => Promise<{ symbols: string[]; fetchedAt: number } | null>
  thesisSymbols?: () => string[] | Promise<string[]>
  /** Earnings-event hook scope for pre/post-earnings rules. */
  symbols?: string[]
  /** Notification dispatcher (kernel host: OS notification + in-app). */
  notify?: (event: NotificationEvent) => void | Promise<void>
  /** V8: preferred UI locale for notification copy (default en-US). */
  locale?: SupportedLocale
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
  const resolvedScope = await resolveScope(rule, ctx, ranAt)
  const symbols = resolvedScope.snapshot.symbols

  const failures: string[] = []
  // Subset of `failures` that decides completeness/outcome: problems with the
  // scope or the materiality evaluation itself. Delivery-side problems
  // (research/notification) are recorded in `failures` only, so one noisy OS
  // notification failure cannot degrade a decided run into incomplete and
  // silently drop it from the daily brief (issue #185).
  const evaluationFailures: string[] = []
  const fail = (message: string, decisive = true) => {
    failures.push(message)
    if (decisive) evaluationFailures.push(message)
  }
  if (resolvedScope.failure !== undefined) fail(resolvedScope.failure)
  if (symbols.length === 0) {
    if (resolvedScope.failure === undefined) {
      fail(`no symbols in scope for ${rule.type}`)
    }
  }

  let evaluated = 0
  let materialChanges = 0
  let analyzed = 0
  let notified = false

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase()
    let evaluation: { signals: MaterialSignals; quote: Quote; probeFailed?: boolean } | null
    try {
      evaluation = await evaluateSymbol(symbol, ctx)
    } catch {
      fail(`${symbol}: evaluation failed`)
      continue
    }
    if (evaluation === null) {
      fail(`${symbol}: quote unavailable`)
      continue
    }
    evaluated += 1
    if (!Number.isFinite(evaluation.signals.priceMovePct)) {
      fail(`${symbol}: previous close unavailable`)
    }
    if (evaluation.probeFailed === true) {
      fail(`${symbol}: earnings calendar probe failed`)
    }
    const material = signalsAreMaterial(evaluation.signals)
    if (material) {
      materialChanges += 1
      try {
        await ctx.researchStart(symbol, rule.strategyId)
        analyzed += 1
      } catch {
        fail(`${symbol}: research analysis failed`, false)
      }
    }
    if (rule.notify === 'all' || material) {
      try {
        await ctx.notify?.(notificationFor(rule, symbol, material, evaluation.signals, ranAt, ctx.locale))
        notified = true
      } catch {
        fail(`${symbol}: notification failed`, false)
      }
    }
  }

  const complete = symbols.length > 0 && evaluated === symbols.length && evaluationFailures.length === 0
  const outcome: AutomationRun['outcome'] = complete
    ? materialChanges > 0
      ? 'material_update'
      : 'no_material_update'
    : 'incomplete'

  return {
    id,
    ruleId: rule.id,
    ranAt,
    evaluated,
    materialChanges,
    analyzed,
    notified,
    failures,
    outcome,
    scopeSnapshot: resolvedScope.snapshot,
  }
}

/** Symbols the rule monitors: rule override → hook scope → type providers. */
async function resolveScope(
  rule: AutomationRule,
  ctx: AutomationRunContext,
  capturedAt: number
): Promise<{ snapshot: AutomationScopeSnapshot; failure?: string }> {
  if (rule.symbols !== undefined && rule.symbols.length > 0) {
    return { snapshot: makeScopeSnapshot('rule', rule.symbols, capturedAt) }
  }
  if (ctx.symbols !== undefined && ctx.symbols.length > 0) {
    return { snapshot: makeScopeSnapshot('hook', ctx.symbols, capturedAt) }
  }
  switch (rule.type) {
    case 'watchlist-daily-review':
      return resolveProviderScope('watchlist', ctx.watchlistSymbols, capturedAt)
    case 'portfolio-daily-brief': {
      if (ctx.portfolioSnapshot !== undefined) {
        try {
          const portfolio = await ctx.portfolioSnapshot()
          if (portfolio === null || !Number.isFinite(portfolio.fetchedAt)) {
            return {
              snapshot: makeScopeSnapshot('portfolio', [], capturedAt),
              failure: 'portfolio snapshot unavailable',
            }
          }
          return {
            snapshot: makeScopeSnapshot('portfolio', portfolio.symbols, capturedAt, portfolio.fetchedAt),
          }
        } catch {
          return {
            snapshot: makeScopeSnapshot('portfolio', [], capturedAt),
            failure: 'portfolio snapshot unavailable',
          }
        }
      }
      return resolveProviderScope('portfolio', ctx.portfolioSymbols, capturedAt)
    }
    case 'weekly-thesis-review':
      return resolveProviderScope('thesis', ctx.thesisSymbols, capturedAt)
    default:
      return { snapshot: makeScopeSnapshot('hook', [], capturedAt) }
  }
}

function resolveProviderScope(
  kind: AutomationScopeKind,
  provider: (() => string[] | Promise<string[]>) | undefined,
  capturedAt: number
): Promise<{ snapshot: AutomationScopeSnapshot; failure?: string }> {
  return Promise.resolve()
    .then(() => provider?.() ?? [])
    .then((symbols) => ({ snapshot: makeScopeSnapshot(kind, symbols, capturedAt) }))
    .catch(() => ({
      snapshot: makeScopeSnapshot(kind, [], capturedAt),
      failure: `${kind} scope unavailable`,
    }))
}

function makeScopeSnapshot(
  kind: AutomationScopeKind,
  symbols: string[],
  capturedAt: number,
  sourceFetchedAt?: number
): AutomationScopeSnapshot {
  const normalizedSymbols = [
    ...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  ].sort()
  return {
    kind,
    symbols: normalizedSymbols,
    capturedAt,
    ...(sourceFetchedAt !== undefined ? { sourceFetchedAt } : {}),
  }
}

/**
 * Lightweight refresh for one symbol. Returns null (symbol skipped) only when
 * the quote itself is unavailable. The optional calendar probe degrades to
 * no-signal when the capability is absent; a failing probe call is surfaced
 * via `probeFailed` so the run can distinguish "no event" from "could not
 * probe" instead of silently reading an error as no signal (issue #185).
 */
async function evaluateSymbol(
  symbol: string,
  ctx: AutomationRunContext
): Promise<{ signals: MaterialSignals; quote: Quote; probeFailed?: boolean } | null> {
  const quote = await fetchQuote(symbol, ctx)
  if (quote === null) return null
  const diff = await ctx.diffRepo.getBySymbol(symbol)
  const signals: MaterialSignals = {
    priceMovePct: priceMovePct(quote),
    diffMaterial: diff?.material === true,
    ratingChanged: hasMaterialRatingChange(diff),
    earningsAnnounced: hasNewEarnings(diff),
  }
  let probeFailed = false
  if (!signals.earningsAnnounced) {
    try {
      signals.earningsAnnounced = await calendarProbe(symbol, ctx)
    } catch {
      probeFailed = true
    }
  }
  return { signals, quote, probeFailed }
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
 * Calendar probe: a `report`/`financial` event dated within the last 7 days
 * means an earnings announcement the research diff may not cover yet. Without
 * the freshness lower bound, any historical event still sitting in the "recent
 * 5" list kept `earningsAnnounced` true forever, re-triggering research and
 * notifications every single day (#168). The capability being absent degrades
 * to no-signal; a failing call throws so the run can record a probe failure
 * rather than silently reporting "no event" (issue #185).
 */
const EARNINGS_PROBE_WINDOW_SECONDS = 7 * 86_400;

async function calendarProbe(symbol: string, ctx: AutomationRunContext): Promise<boolean> {
  const cap = ctx.registry.get('research.events')
  if (!cap) return false
  const result = await cap.execute(
    { eventType: 'report', symbols: [symbol], count: 5 },
    { now: ctx.now }
  )
  const events = result.data as CalendarEvent[]
  const nowSeconds = (ctx.now?.() ?? Date.now()) / 1000
  return events.some(
    (event) =>
      (event.type === 'report' || event.type === 'financial') &&
      event.date <= nowSeconds &&
      event.date > nowSeconds - EARNINGS_PROBE_WINDOW_SECONDS
  )
}

/**
 * Abs percent move vs previous close; undefined when either price is unusable.
 * Dirty data can carry NaN — a NaN move must read as "unusable baseline"
 * (→ recorded failure), not as a silent no-signal (issue #185).
 */
function priceMovePct(quote: Quote): number | undefined {
  const lastPrice = quote.lastPrice
  const prevClose = quote.prevClose
  if (!Number.isFinite(lastPrice) || !Number.isFinite(prevClose) || prevClose <= 0) {
    return undefined
  }
  const pct = (Math.abs(lastPrice - prevClose) / prevClose) * 100
  return Number.isFinite(pct) ? pct : undefined
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
  at: number,
  locale?: SupportedLocale
): NotificationEvent {
  const i18n = createSyncI18n({ locale: locale ?? 'en-US' })
  const t = i18n.t.bind(i18n)
  const typeLabel = t(AUTOMATION_TYPE_KEYS[rule.type])
  const pct = signals.priceMovePct
  const pctText = pct !== undefined && material ? `${pct.toFixed(1)}%` : ''
  // V8 (spec §47): localized notification copy; the symbol stays as-is and the
  // detailed signal description rides in the structured payload (never visible
  // as raw English in the OS banner).
  const title = material
    ? t('automation.notification.materialTitle', { symbol })
    : t('automation.notification.noMaterialTitle', { symbol })
  const message = material
    ? t('automation.notification.materialBodyDetail', { symbol, type: typeLabel, pct: pctText })
    : t('automation.notification.noMaterialBodyDetail', { symbol, type: typeLabel })
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

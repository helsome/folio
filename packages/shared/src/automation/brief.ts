import type { AlertTriggerEvent, AutomationRun, ResearchDiff } from '@finagent/core'
import { MATERIAL_PRICE_MOVE_PCT } from '../research-diff/materiality.ts'

/**
 * Deterministic Daily Brief builder (spec §27–28).
 *
 * The brief only ever surfaces explainable items: every entry carries a
 * `source` ∈ {Portfolio, Watchlist, Thesis, Alert, Automation} and a payload
 * that the UI exposes under "Why am I seeing this?". No random news, no
 * vendor text — inputs come from the app's own domains.
 *
 * Pure module (no node imports) so it can be exercised from the main process
 * and, if ever needed, the renderer.
 */

export type BriefItemSource = 'Portfolio' | 'Watchlist' | 'Thesis' | 'Alert' | 'Automation'

export type BriefSeverity = 'info' | 'warning' | 'critical'

export interface BriefItem {
  id: string
  symbol?: string
  title: string
  message: string
  source: BriefItemSource
  severity: BriefSeverity
  /** Structured explainability payload for "Why am I seeing this?". */
  payload?: Record<string, unknown>
}

export interface BriefQuietState {
  count: number
  message: string
}

export interface DailyBrief {
  generatedAt: number
  items: BriefItem[]
  /** "N things need your attention" summary (spec §27). */
  summary: string
  /** Monitored securities that stayed below the materiality bar. */
  quiet: BriefQuietState
}

/** A portfolio exposure note the caller assembles from the portfolio view. */
export interface BriefPortfolioSummary {
  /** e.g. "NVDA.US · 12.4% of portfolio". */
  label: string
  symbol?: string
  detail?: string
  severity?: BriefSeverity
  payload?: Record<string, unknown>
}

/** A watchlist mover row, matching the Today view's mover shape. */
export interface BriefWatchlistMover {
  symbol: string
  changePercent: number
  lastPrice?: number
  payload?: Record<string, unknown>
}

export interface BriefInputs {
  /** Recent automation runs (automation results). */
  runs: AutomationRun[]
  /** Triggered alert events (triggered alerts). */
  alerts: AlertTriggerEvent[]
  /** Latest research diffs per symbol (watchlist changes + thesis impact). */
  diffs: ResearchDiff[]
  /** Portfolio exposure notes. */
  portfolio: BriefPortfolioSummary[]
  /** Watchlist movers from the quote cache. */
  movers: BriefWatchlistMover[]
}

const SOURCE_ORDER: readonly BriefItemSource[] = [
  'Portfolio',
  'Watchlist',
  'Thesis',
  'Alert',
  'Automation',
]

const SEVERITY_RANK: Record<BriefSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** Build a deterministic DailyBrief from app-domain inputs. */
export function buildBrief(inputs: BriefInputs, now: number = Date.now()): DailyBrief {
  const items = [
    ...portfolioItems(inputs),
    ...watchlistItems(inputs),
    ...thesisItems(inputs),
    ...alertItems(inputs),
    ...automationItems(inputs),
  ]
  items.sort(compareItems)

  const monitored = union([...inputs.movers.map((m) => m.symbol), ...inputs.diffs.map((d) => d.symbol)])
  const materialSymbols = union([
    ...inputs.movers
      .filter((m) => Math.abs(m.changePercent) >= MATERIAL_PRICE_MOVE_PCT)
      .map((m) => m.symbol),
    ...inputs.diffs.filter((d) => d.material).map((d) => d.symbol),
  ])
  const quietCount = monitored.filter((symbol) => !materialSymbols.includes(symbol)).length

  return {
    generatedAt: now,
    items,
    summary:
      items.length > 0
        ? `${items.length} ${items.length === 1 ? 'thing needs' : 'things need'} your attention.`
        : 'Nothing needs your attention.',
    quiet: {
      count: quietCount,
      message:
        quietCount > 0
          ? `${quietCount} monitored ${quietCount === 1 ? 'security' : 'securities'}: no material change`
          : 'No monitored securities.',
    },
  }
}

function portfolioItems(inputs: BriefInputs): BriefItem[] {
  return inputs.portfolio.map((summary, index) => ({
    id: `portfolio-${index}`,
    symbol: summary.symbol,
    title: summary.label,
    message: summary.detail ?? 'Portfolio exposure note.',
    source: 'Portfolio',
    severity: summary.severity ?? 'info',
    payload: summary.payload,
  }))
}

function watchlistItems(inputs: BriefInputs): BriefItem[] {
  const moverItems: BriefItem[] = inputs.movers
    .filter((mover) => Math.abs(mover.changePercent) >= MATERIAL_PRICE_MOVE_PCT)
    .map((mover) => ({
      id: `watchlist-${mover.symbol}-mover`,
      symbol: mover.symbol,
      title: `${mover.symbol} moved ${formatSigned(mover.changePercent)}%`,
      message: 'Price move crossed the materiality bar vs previous close.',
      source: 'Watchlist',
      severity: 'warning',
      payload: { changePercent: mover.changePercent, lastPrice: mover.lastPrice, ...mover.payload },
    }))

  const diffItems: BriefItem[] = inputs.diffs
    .filter((diff) => diff.material)
    .map((diff) => ({
      id: `watchlist-${diff.symbol}-diff`,
      symbol: diff.symbol,
      title: `${diff.symbol} material research change`,
      message: diff.summary ?? `${diff.changes.length} material change(s) vs the previous report.`,
      source: 'Watchlist',
      severity: 'warning',
      payload: { diffId: diff.id, changes: diff.changes.length },
    }))

  return [...moverItems, ...diffItems]
}

function thesisItems(inputs: BriefInputs): BriefItem[] {
  return inputs.diffs
    .filter((diff) => diff.thesisImpact !== undefined && diff.thesisImpact.direction !== 'unchanged')
    .map((diff) => ({
      id: `thesis-${diff.symbol}`,
      symbol: diff.symbol,
      title: `${diff.symbol} thesis ${diff.thesisImpact?.direction ?? 'unchanged'}`,
      message: diff.thesisImpact?.summary ?? 'Thesis impact detected.',
      source: 'Thesis',
      severity: diff.thesisImpact?.direction === 'invalidated' ? 'critical' : 'warning',
      payload: { diffId: diff.id, direction: diff.thesisImpact?.direction },
    }))
}

function alertItems(inputs: BriefInputs): BriefItem[] {
  return inputs.alerts.map((alert) => ({
    id: `alert-${alert.id}`,
    symbol: alert.symbol,
    title: alert.title,
    message: alert.message,
    source: 'Alert',
    severity: 'warning',
    payload: { ruleId: alert.ruleId, ruleType: alert.ruleType, ...alert.payload },
  }))
}

function automationItems(inputs: BriefInputs): BriefItem[] {
  return inputs.runs
    .filter((run) => run.materialChanges > 0 || run.notified)
    .map((run) => ({
      id: `automation-${run.id}`,
      title:
        run.materialChanges > 0
          ? `Automation: ${run.materialChanges} material change${run.materialChanges === 1 ? '' : 's'}`
          : `Automation: ${run.ruleId} completed`,
      message: `Evaluated ${run.evaluated} securities, analyzed ${run.analyzed}.`,
      source: 'Automation',
      severity: run.materialChanges > 0 ? 'warning' : 'info',
      payload: {
        ruleId: run.ruleId,
        evaluated: run.evaluated,
        analyzed: run.analyzed,
        failures: run.failures,
      },
    }))
}

function compareItems(a: BriefItem, b: BriefItem): number {
  const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (severityDiff !== 0) return severityDiff
  const sourceDiff = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)
  if (sourceDiff !== 0) return sourceDiff
  const symbolDiff = (a.symbol ?? '').localeCompare(b.symbol ?? '')
  if (symbolDiff !== 0) return symbolDiff
  return a.title.localeCompare(b.title)
}

/** Deduplicated, sorted symbol list. */
function union(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].sort()
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}

import React, { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { AlertTriggerEvent, ApiResult, CalendarEvent, InvestmentThesis, ResearchReport } from '@finagent/core'
import {
  activeSymbolAtom,
  alertStateAtom,
  fetchPortfolioAtom,
  fetchQuoteAtom,
  loadAlertsAtom,
  navSectionAtom,
  portfolioCacheAtom,
  portfolioViewAtom,
  watchlistAtom,
} from '../../atoms'
import { watchlistMoversAtom, mapUpcomingEvents, thesesNeedingReview } from '../../atoms/todayAtoms'
import { analyzePortfolioRiskAtom } from '../../atoms/portfolioRiskAtoms'
import { loadSymbolReports } from '../../atoms/researchAtoms'
import { loadTheses } from '../../client/thesis'
import { useFinagentClient, type FinagentClient } from '../../client'
import { formatMoney, formatPercent } from '../../lib/money'
import { PortfolioCard } from '../portfolio/PortfolioCard'
import { Button } from '../primitives/Button'
import { SectionState, TodaySection } from './TodaySection'

const MOVER_ROWS = 5
const EVENT_ROWS = 10
const REPORT_ROWS = 5
const DASH = '\u2014'

function formatWhen(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return DASH
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Defensive calendar-event loader. `FinagentClient.market` has no calendar
 * method yet (see "needed channel" in the completion report); this degrades to
 * `[]` so the Upcoming Events section renders its honest empty state.
 */
interface CalendarCapableMarket {
  getCalendarEvents?: (input: { eventType?: string; symbols?: string[] }) => Promise<ApiResult<CalendarEvent[]>>
}

async function loadUpcomingEvents(client: FinagentClient, symbols: string[]): Promise<CalendarEvent[]> {
  const market = client.market as unknown as CalendarCapableMarket
  const fetch = market?.getCalendarEvents
  if (typeof fetch !== 'function') return []
  try {
    const result = await fetch({ eventType: 'financial', symbols })
    return result.ok ? result.data : []
  } catch {
    return []
  }
}

export const TodayView: React.FC = () => {
  const client = useFinagentClient()
  const watchlist = useAtomValue(watchlistAtom)
  const movers = useAtomValue(watchlistMoversAtom)
  const portfolioView = useAtomValue(portfolioViewAtom)
  const portfolioCache = useAtomValue(portfolioCacheAtom)
  const alertState = useAtomValue(alertStateAtom)
  const activeSymbol = useAtomValue(activeSymbolAtom)

  const setActiveSymbol = useSetAtom(activeSymbolAtom)
  const setNavSection = useSetAtom(navSectionAtom)
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom)
  const fetchQuote = useSetAtom(fetchQuoteAtom)
  const loadAlerts = useSetAtom(loadAlertsAtom)
  const analyzeRisk = useSetAtom(analyzePortfolioRiskAtom)

  const [quotesLoading, setQuotesLoading] = useState(true)
  const [reports, setReports] = useState<ResearchReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [theses, setTheses] = useState<InvestmentThesis[]>([])
  const [thesesLoading, setThesesLoading] = useState(true)
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Portfolio + alerts hydrate their shared atoms; fire-and-forget.
      void fetchPortfolio(client)
      void loadAlerts(client)

      // Quotes gate the movers section.
      setQuotesLoading(true)
      await Promise.all(watchlist.map((symbol) => fetchQuote({ client, symbol })))
      if (cancelled) return
      setQuotesLoading(false)

      const [nextReports, nextTheses, nextEvents] = await Promise.all([
        loadSymbolReports(),
        loadTheses(),
        loadUpcomingEvents(client, watchlist),
      ])
      if (cancelled) return
      setReports(nextReports)
      setReportsLoading(false)
      setTheses(nextTheses)
      setThesesLoading(false)
      setUpcomingEvents(nextEvents)
      setEventsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [client, watchlist, fetchPortfolio, loadAlerts, fetchQuote])

  const handleResearchStock = (): void => {
    if (activeSymbol == null && watchlist.length > 0) setActiveSymbol(watchlist[0])
    setNavSection('research')
  }

  const handleAnalyzePortfolio = (): void => {
    setNavSection('portfolio')
    void analyzeRisk().catch(() => undefined)
  }

  const handleCompare = (): void => {
    setNavSection('compare')
  }

  // ── Section content ────────────────────────────────────────────────────

  const portfolioContent = (() => {
    if (portfolioCache.loading && !portfolioView) return <SectionState kind="loading" />
    if (portfolioView) return <PortfolioCard view={portfolioView} />
    const failure = portfolioCache.failure
    if (failure?.kind === 'not-connected' || failure?.kind === 'no-account-permission') {
      return <SectionState kind="empty" message="Connect Longbridge to see your portfolio." />
    }
    if (failure) return <SectionState kind="error" message={failure.message} />
    if (portfolioCache.error) return <SectionState kind="error" message={portfolioCache.error} />
    return <SectionState kind="empty" message="No portfolio data yet." />
  })()

  const moversContent = (() => {
    if (quotesLoading && movers.length === 0) return <SectionState kind="loading" />
    if (movers.length === 0) {
      return (
        <SectionState
          kind="empty"
          message={watchlist.length === 0 ? 'Add symbols to your watchlist to see movers.' : 'No movers yet.'}
        />
      )
    }
    return (
      <ul className="space-y-1">
        {movers.slice(0, MOVER_ROWS).map((mover) => (
          <li key={mover.symbol} className="flex items-center justify-between py-1">
            <span className="text-[13px] font-medium text-foreground">{mover.symbol}</span>
            <span className="flex items-center gap-4">
              <span className="text-[13px] text-foreground/78">
                {mover.lastPrice !== undefined ? formatMoney(mover.lastPrice, 'USD') : DASH}
              </span>
              <span className={`w-16 text-right text-[13px] font-semibold ${(mover.changePercent ?? 0) >= 0 ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]'}`}>
                {formatPercent(mover.changePercent)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    )
  })()

  const triggeredAlerts = alertState.events
    .filter((event) => event != null)
    .slice()
    .sort((a, b) => b.triggeredAt - a.triggeredAt)
    .slice(0, 5)

  const alertsContent = (() => {
    if (alertState.loading && triggeredAlerts.length === 0) return <SectionState kind="loading" />
    if (triggeredAlerts.length === 0) return <SectionState kind="empty" message="No triggered alerts." />
    return (
      <ul className="space-y-1">
        {triggeredAlerts.map((event: AlertTriggerEvent) => (
          <li key={event.id} className="flex items-start justify-between gap-3 py-1">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {event.symbol ? `${event.symbol} · ` : ''}{event.title}
              </div>
              {event.message && (
                <div className="truncate text-[12px] text-foreground/54">{event.message}</div>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(event.triggeredAt)}</span>
          </li>
        ))}
      </ul>
    )
  })()

  const upcomingItems = mapUpcomingEvents(upcomingEvents, Date.now() / 1000, EVENT_ROWS)

  const upcomingContent = (() => {
    if (eventsLoading && upcomingItems.length === 0) return <SectionState kind="loading" />
    if (upcomingItems.length === 0) {
      return (
        <SectionState
          kind="empty"
          message="Upcoming events are not available yet (calendar channel not wired)."
        />
      )
    }
    return (
      <ul className="space-y-1">
        {upcomingItems.map((event) => (
          <li key={event.id} className="flex items-start justify-between gap-3 py-1">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {event.symbol ? `${event.symbol} · ` : ''}{event.name ?? event.content ?? event.type}
              </div>
              {event.content && event.name && (
                <div className="truncate text-[12px] text-foreground/54">{event.content}</div>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-foreground/38">{event.localDate ?? DASH}</span>
          </li>
        ))}
      </ul>
    )
  })()

  const recentReports = reports
    .filter((report) => report != null)
    .slice()
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(0, REPORT_ROWS)

  const researchContent = (() => {
    if (reportsLoading && recentReports.length === 0) return <SectionState kind="loading" />
    if (recentReports.length === 0) return <SectionState kind="empty" message="No research reports yet." />
    return (
      <ul className="space-y-1">
        {recentReports.map((report) => (
          <li key={report.id} className="flex items-start justify-between gap-3 py-1">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {report.symbol} · <span className="capitalize">{report.stance}</span>
              </div>
              <div className="truncate text-[12px] text-foreground/54">{report.summary}</div>
            </div>
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(report.generatedAt)}</span>
          </li>
        ))}
      </ul>
    )
  })()

  const needsReview = thesesNeedingReview(theses).slice(0, 5)

  const thesesContent = (() => {
    if (thesesLoading && needsReview.length === 0) return <SectionState kind="loading" />
    if (needsReview.length === 0) return <SectionState kind="empty" message="All theses are up to date." />
    return (
      <ul className="space-y-1">
        {needsReview.map((thesis) => (
          <li key={thesis.id} className="flex items-start justify-between gap-3 py-1">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {thesis.symbol} · <span className="capitalize">{thesis.stance}</span>
              </div>
              <div className="truncate text-[12px] text-foreground/54">{thesis.summary}</div>
            </div>
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(thesis.updatedAt)}</span>
          </li>
        ))}
      </ul>
    )
  })()

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="today-view">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-semibold tracking-tight text-foreground">Today</h1>
        <Button variant="outline" size="sm" onClick={handleResearchStock}>Research a stock</Button>
        <Button variant="outline" size="sm" onClick={handleAnalyzePortfolio}>Analyze Portfolio</Button>
        <Button variant="outline" size="sm" onClick={handleCompare}>Compare</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TodaySection title="Portfolio">{portfolioContent}</TodaySection>
        <TodaySection title="Watchlist movers">{moversContent}</TodaySection>
        <TodaySection title="Triggered alerts">{alertsContent}</TodaySection>
        <TodaySection title="Upcoming events">{upcomingContent}</TodaySection>
        <TodaySection title="Recent research">{researchContent}</TodaySection>
        <TodaySection title="Theses needing review">{thesesContent}</TodaySection>
      </div>
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import { ArrowUpRight, BriefcaseBusiness, GitCompareArrows, Search, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next';
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
import { Dialog } from '../primitives/Dialog'
import { SectionState, TodaySection } from './TodaySection'
import { DailyBriefSection } from './DailyBriefSection'
import { AutomationRulesView } from '../automation/AutomationRulesView'
import { MarketPulse } from '../pulse/MarketPulse'

const MOVER_ROWS = 5
const EVENT_ROWS = 10
const REPORT_ROWS = 5
const DASH = '\u2014'

function formatWhen(timestamp: number, t: TFunction): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return DASH
  const diff = Date.now() - timestamp
  if (diff < 60_000) return t('today.justNow')
  if (diff < 3_600_000) return t('today.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('today.hoursAgo', { count: Math.floor(diff / 3_600_000) })
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
  const { t } = useTranslation()
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
  const [automationOpen, setAutomationOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    const value = searchQuery.trim().toUpperCase()
    if (/^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/.test(value)) {
      setActiveSymbol(value)
      setNavSection('watchlist')
      setSearchQuery('')
    }
  }

  // ── Section content ────────────────────────────────────────────────────

  const portfolioContent = (() => {
    if (portfolioCache.loading && !portfolioView) return <SectionState kind="loading" />
    if (portfolioView) return <PortfolioCard view={portfolioView} />
    const failure = portfolioCache.failure
    if (failure?.kind === 'not-connected' || failure?.kind === 'no-account-permission') {
      return <SectionState kind="empty" message={t('today.connectPortfolio')} />
    }
    if (failure) return <SectionState kind="error" message={failure.message} />
    if (portfolioCache.error) return <SectionState kind="error" message={portfolioCache.error} />
    return <SectionState kind="empty" message={t('today.noPortfolioData')} />
  })()

  const moversContent = (() => {
    if (quotesLoading && movers.length === 0) return <SectionState kind="loading" />
    if (movers.length === 0) {
      return (
        <SectionState
          kind="empty"
          message={watchlist.length === 0 ? t('today.addSymbolsForMovers') : t('today.noMovers')}
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
    if (triggeredAlerts.length === 0) return <SectionState kind="empty" message={t('today.noTriggeredAlerts')} />
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
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(event.triggeredAt, t)}</span>
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
          message={t('today.eventsUnavailable')}
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
    if (recentReports.length === 0) return <SectionState kind="empty" message={t('today.noResearchReports')} />
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
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(report.generatedAt, t)}</span>
          </li>
        ))}
      </ul>
    )
  })()

  const needsReview = thesesNeedingReview(theses).slice(0, 5)

  const thesesContent = (() => {
    if (thesesLoading && needsReview.length === 0) return <SectionState kind="loading" />
    if (needsReview.length === 0) return <SectionState kind="empty" message={t('today.allThesesUpToDate')} />
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
            <span className="shrink-0 text-[11px] text-foreground/38">{formatWhen(thesis.updatedAt, t)}</span>
          </li>
        ))}
      </ul>
    )
  })()

  return (
    <div className="h-full overflow-y-auto px-5 py-6" data-testid="today-view">
      <section data-testid="today-hero" className="mb-5 rounded-[12px] border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-accent"><Sparkles className="h-3.5 w-3.5" />{t('today.quietWorkspace')}</div><h1 className="mt-2 text-[24px] font-semibold tracking-[-.02em] text-foreground">{t('today.greeting')}</h1><p className="mt-1 text-[13px] text-foreground/52">{t('today.heroSubtitle')}</p></div>
          <div className="flex min-w-[280px] flex-1 justify-end"><label className="relative block w-full max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/34" /><input data-testid="today-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder={t('today.searchPlaceholder')} aria-label={t('today.searchAria')} className="h-10 w-full rounded-[9px] border border-input bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-foreground/38 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring" /></label></div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <QuickAction icon={Search} label={t('today.quickActionDeepResearch')} hint={t('today.quickActionDeepResearchHint')} onClick={handleResearchStock} tone="blue" />
          <QuickAction icon={BriefcaseBusiness} label={t('today.quickActionReviewPortfolio')} hint={t('today.quickActionReviewPortfolioHint')} onClick={handleAnalyzePortfolio} tone="green" />
          <QuickAction icon={GitCompareArrows} label={t('today.quickActionCompareStocks')} hint={t('today.quickActionCompareStocksHint')} onClick={handleCompare} tone="violet" />
        </div>
      </section>

      <div className="mb-3">
        <DailyBriefSection onManage={() => setAutomationOpen(true)} />
      </div>
      <div className="mb-3">
        <MarketPulse />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TodaySection title={t('today.portfolio')}>{portfolioContent}</TodaySection>
        <TodaySection title={t('today.watchlistMovers')}>{moversContent}</TodaySection>
        <TodaySection title={t('today.triggeredAlerts')}>{alertsContent}</TodaySection>
        <TodaySection title={t('today.upcomingEvents')}>{upcomingContent}</TodaySection>
        <TodaySection title={t('today.recentResearch')}>{researchContent}</TodaySection>
        <TodaySection title={t('today.thesesNeedingReview')}>{thesesContent}</TodaySection>
      </div>

      <Dialog open={automationOpen} onClose={() => setAutomationOpen(false)} title={t('today.automation')}>
        <AutomationRulesView />
      </Dialog>
    </div>
  )
}

const QuickAction: React.FC<{
  icon: LucideIcon
  label: string
  hint: string
  tone: 'blue' | 'green' | 'violet'
  onClick: () => void
}> = ({ icon: Icon, label, hint, tone, onClick }) => (
  <button type="button" onClick={onClick} className={`group flex items-center gap-3 rounded-[9px] border border-border px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover ${tone === 'blue' ? 'bg-accent/5' : tone === 'green' ? 'bg-positive/5' : 'bg-info/5'}`}>
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${tone === 'blue' ? 'bg-accent/10 text-accent' : tone === 'green' ? 'bg-positive/10 text-positive' : 'bg-info/10 text-info'}`}><Icon className="h-4 w-4" strokeWidth={1.8} /></span>
    <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-foreground">{label}</span><span className="mt-0.5 block truncate text-[11px] text-foreground/44">{hint}</span></span>
    <ArrowUpRight className="h-3.5 w-3.5 text-foreground/28 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
  </button>
)

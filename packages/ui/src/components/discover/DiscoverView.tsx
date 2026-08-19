import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { SupportedLocale } from '@finagent/i18n'
import type { ScreeningCandidate, ScreeningRun, ScreeningStrategy } from '@finagent/core'
import { activeSymbolAtom, addToWatchlistAtom, navSectionAtom, watchlistAtom, settingsTabAtom } from '../../atoms'
import { compareSymbolsAtom } from '../../atoms/compareAtoms'
import {
  DISCOVER_TASKS,
  FAMILY_ORDER,
  RESEARCH_STRATEGY_BY_TASK,
  tasksByFamily,
  type DiscoverTask,
  type StrategyFamily,
} from '../../atoms/discoverAtoms'
import {
  screeningErrorAtom,
  screeningLastRunAtom,
  screeningResultsAtom,
  screeningRunsAtom,
  screeningRunningStrategyAtom,
  pendingResearchStrategyAtom,
} from '../../atoms/discoverAtoms'
import { useFinagentClient } from '../../client'
import { getScreeningRun, listScreeningRuns, runScreening } from '../../client/screening'
import { Button } from '../primitives/Button'
import { CandidateCard, type CandidateAction } from './CandidateCard'
import { TaskCard } from './TaskCard'

const RESULT_LIMIT = 8

function failureNote(run: ScreeningRun | null): string[] {
  if (!run) return []
  const entries = Object.entries(run.failures)
  if (entries.length === 0) return []
  return entries.map(([id, message]) => `${id}: ${message}`)
}

type DiscoverMode = 'browse' | 'running' | 'results'

/**
 * Discover (spec §4–25): task-driven screening with an explicit Browse /
 * Running / Results state machine. Running a task switches immediately into a
 * dedicated result view (top of the viewport) instead of dumping results below
 * the whole strategy catalog; history reopens land directly in results mode.
 */
export const DiscoverView: React.FC = () => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const client = useFinagentClient()
  const watchlist = useAtomValue(watchlistAtom)
  const [running, setRunning] = useAtom(screeningRunningStrategyAtom)
  const [results, setResults] = useAtom(screeningResultsAtom)
  const [lastRun, setLastRun] = useAtom(screeningLastRunAtom)
  const [error, setError] = useAtom(screeningErrorAtom)
  const [runs, setRuns] = useAtom(screeningRunsAtom)

  const setActiveSymbol = useSetAtom(activeSymbolAtom)
  const setCompareSymbols = useSetAtom(compareSymbolsAtom)
  const setNavSection = useSetAtom(navSectionAtom)
  const addToWatchlist = useSetAtom(addToWatchlistAtom)
  const setPendingStrategy = useSetAtom(pendingResearchStrategyAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const [runsLoading, setRunsLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const mode: DiscoverMode = running !== null ? 'running' : results !== null ? 'results' : 'browse'

  const refreshRuns = useCallback(async () => {
    const history = await listScreeningRuns(client)
    setRuns(history)
    setRunsLoading(false)
  }, [client, setRuns])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  // Modal transition helper (§8): keep the container at the top of the viewport.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [mode])

  const handleRun = useCallback(
    async (task: DiscoverTask) => {
      if (running) return
      setRunning(task.id)
      setError(null)
      setResults(null)
      const universe = watchlist.length > 0 ? watchlist : undefined
      const run = await runScreening(client, {
        strategy: task.id,
        universe,
        limit: RESULT_LIMIT,
      })
      if (run) {
        setLastRun(run)
        setResults(run.candidates)
        void refreshRuns()
      } else {
        setError(t('discover.notAvailable'))
      }
      setRunning(null)
    },
    [client, running, watchlist, setRunning, setError, setResults, setLastRun, refreshRuns, t]
  )

  const handleReopen = useCallback(
    async (runId: string) => {
      setError(null)
      const run = await getScreeningRun(client, runId)
      if (run) {
        setLastRun(run)
        setResults(run.candidates)
        setHistoryOpen(false)
      } else {
        setError(t('discover.reloadFailed'))
      }
    },
    [client, setError, setLastRun, setResults, t]
  )

  const handleBack = useCallback(() => {
    setRunning(null)
    setResults(null)
    setLastRun(null)
    setError(null)
    setHistoryOpen(false)
  }, [setRunning, setResults, setLastRun, setError])

  const handleAction = useCallback(
    (action: CandidateAction, candidate: ScreeningCandidate) => {
      if (action === 'watch') {
        addToWatchlist(candidate.symbol)
        return
      }
      if (action === 'compare') {
        setCompareSymbols([candidate.symbol])
        setNavSection('compare')
        return
      }
      // research — carry the candidate's strategy recommendation forward.
      setActiveSymbol(candidate.symbol)
      const strategy = lastRun ? RESEARCH_STRATEGY_BY_TASK[lastRun.strategy] : null
      setPendingStrategy(strategy)
      setNavSection('research')
    },
    [addToWatchlist, setActiveSymbol, setCompareSymbols, setNavSection, setPendingStrategy, lastRun]
  )

  const goToConnections = useCallback(() => {
    setSettingsTab('connections')
    setNavSection('settings')
  }, [setSettingsTab, setNavSection])

  const strategyTitle = (id: ScreeningStrategy): string =>
    DISCOVER_TASKS.some((task) => task.id === id) ? t(`discover.strategy.${id}.title`) : id

  const runTitle = lastRun ? strategyTitle(lastRun.strategy) : ''

  const scope =
    watchlist.length > 0
      ? t('discover.scopeWatchlist', { count: watchlist.length })
      : t('discover.scopeUniverse')

  const failures = failureNote(lastRun)
  const hasFailures = failures.length > 0

  const backButton = (
    <button
      type="button"
      onClick={handleBack}
      data-testid="discover-back"
      className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
    >
      ← {t('discover.back')}
    </button>
  )

  const rerunButton = lastRun ? (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={() => {
        const task = DISCOVER_TASKS.find((entry) => entry.id === lastRun.strategy)
        if (task) void handleRun(task)
      }}
      data-testid="discover-rerun"
    >
      {t('discover.rerun')}
    </Button>
  ) : null

  // ── Result list ───────────────────────────────────────────────────────────
  const resultList = (
    <>
      {results && results.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          <div
            className="grid grid-cols-[minmax(0,1.6fr)_92px_92px_52px_auto] gap-3 border-b border-border bg-surface-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/38"
            data-testid="discover-results-header"
          >
            <span>{t('discover.security')}</span>
            <span className="text-right">{t('discover.price')}</span>
            <span className="text-right">{t('discover.change')}</span>
            <span className="text-right">{t('discover.score')}</span>
            <span className="sr-only">{t('discover.actions')}</span>
          </div>
          {results.map((candidate) => (
            <CandidateCard
              key={candidate.symbol}
              candidate={candidate}
              watched={watchlist.includes(candidate.symbol)}
              onAction={handleAction}
              locale={locale}
            />
          ))}
        </div>
      )}
    </>
  )

  // ── Render by mode ────────────────────────────────────────────────────────
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4" data-testid="discover-view">
      {mode === 'browse' && (
        <>
          <div className="mb-1">
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{t('discover.title')}</h1>
            <p className="mt-0.5 text-[12.5px] text-foreground/54">{t('discover.subtitle', { scope })}</p>
          </div>

          {error && (
            <div
              role="alert"
              data-testid="discover-error"
              className="mb-3 rounded-[10px] border border-[var(--mac-red-soft)] bg-[var(--mac-red-soft)]/20 px-3 py-2 text-[12.5px] text-destructive"
            >
              {error}
            </div>
          )}

          <div className="space-y-5">
            {FAMILY_ORDER.map((family: StrategyFamily) => (
              <section key={family} data-testid={`discover-family-${family}`} aria-label={t(`discover.family.${family}`)}>
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
                  {t(`discover.family.${family}`)}
                </h2>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {tasksByFamily(family).map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      running={running === task.id}
                      disabled={running !== null}
                      onRun={handleRun}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Lightweight recent runs (§9). */}
          <section className="mt-6" data-testid="discover-history" aria-label={t('discover.previousRunsAria')}>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
              {t('discover.previousRuns')}
            </h2>
            {runsLoading ? (
              <div className="py-4 text-center text-[12.5px] text-foreground/40">{t('common.loading')}</div>
            ) : runs.length === 0 ? (
              <div className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-4 text-center text-[12.5px] text-foreground/48">
                {t('discover.noRuns')}
              </div>
            ) : (
              <HistoryList runs={runs} onReopen={handleReopen} strategyTitle={strategyTitle} />
            )}
          </section>
        </>
      )}

      {mode === 'running' && (
        <div data-testid="discover-running" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {backButton}
            <div className="min-w-0 text-right">
              {rerunButton}
            </div>
          </div>
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-[2px] border-[var(--mac-border-strong)] border-t-transparent"
              />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-foreground">
                  {running ? strategyTitle(running) : ''}
                </div>
                <div className="mt-0.5 text-[12.5px] text-foreground/54">{t('discover.runningHint', { scope })}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2" aria-hidden="true" data-testid="discover-running-skeleton">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-[8px] bg-foreground/5" />
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'results' && (
        <div data-testid="discover-results" aria-label={t('discover.resultsAria')} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {backButton}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryOpen((value) => !value)}
                aria-haspopup="true"
                aria-expanded={historyOpen}
                data-testid="discover-history-toggle"
                className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
              >
                {t('discover.previousRuns')}
              </button>
              {rerunButton}
            </div>
          </div>

          {historyOpen && (
            <div data-testid="discover-history-panel" className="rounded-[10px] border border-border bg-surface p-2">
              {runs.length === 0 ? (
                <div className="px-3 py-3 text-center text-[12px] text-foreground/44">{t('discover.noRuns')}</div>
              ) : (
                <HistoryList runs={runs} onReopen={handleReopen} strategyTitle={strategyTitle} />
              )}
            </div>
          )}

          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{runTitle}</h1>
            <p className="mt-0.5 text-[12.5px] text-foreground/54">
              {t('discover.candidates', { count: results?.length ?? 0 })} · {scope}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              data-testid="discover-error"
              className="rounded-[10px] border border-[var(--mac-red-soft)] bg-[var(--mac-red-soft)]/20 px-3 py-2 text-[12.5px] text-destructive"
            >
              {error}
            </div>
          )}

          {/* Provider warning (§22): human-readable, i18n, with a connections link. */}
          {hasFailures && (
            <div
              role="status"
              data-testid="discover-provider-warning"
              className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12.5px] font-medium text-foreground">{t('discover.providerWarning')}</div>
                <button
                  type="button"
                  onClick={goToConnections}
                  data-testid="discover-goto-connections"
                  className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-accent transition-smooth hover:border-[var(--mac-border-strong)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
                >
                  {t('discover.goToConnections')}
                </button>
              </div>
              <p className="mt-1 text-[12px] text-foreground/54">{t('discover.providerWarningDetail')}</p>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-foreground/44">
                  {t('discover.failureDetails', { count: failures.length })}
                </summary>
                <ul className="mt-1 space-y-0.5 text-[11px] text-foreground/44">
                  {failures.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {/* Partial Data banner (§23): candidates exist but some sources failed. */}
          {hasFailures && results && results.length > 0 && (
            <div
              data-testid="discover-failures"
              className="rounded-[8px] border border-[var(--mac-border)] bg-background/40 px-3 py-1.5 text-[11.5px] text-foreground/48"
            >
              {t('discover.partialData')}
            </div>
          )}

          {results && results.length === 0 ? (
            <div
              data-testid="discover-empty"
              className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-6 text-center"
            >
              <div className="text-[13px] font-medium text-foreground">{t('discover.noCandidates')}</div>
              <ul className="mx-auto mt-2 inline-block list-disc space-y-0.5 pl-5 text-left text-[12px] text-foreground/54">
                <li>{t('discover.emptyTry1')}</li>
                <li>{t('discover.emptyTry2')}</li>
                <li>
                  <button
                    type="button"
                    onClick={goToConnections}
                    className="text-accent underline underline-offset-2 hover:opacity-80"
                    data-testid="discover-empty-connections"
                  >
                    {t('discover.emptyTry3')}
                  </button>
                </li>
              </ul>
            </div>
          ) : (
            resultList
          )}
        </div>
      )}
    </div>
  )
}

function HistoryList({
  runs,
  onReopen,
  strategyTitle,
}: {
  runs: ScreeningRun[]
  onReopen: (runId: string) => void
  strategyTitle: (id: ScreeningStrategy) => string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <ul className="space-y-1.5">
      {runs.map((run) => {
        const task = DISCOVER_TASKS.find((entry) => entry.id === run.strategy)
        return (
          <li
            key={run.id}
            className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--mac-border)] bg-background/40 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-foreground">
                {task ? strategyTitle(run.strategy) : run.strategy}
              </div>
              <div className="text-[11.5px] text-foreground/44">
                {new Date(run.createdAt).toLocaleString()} · {t('discover.candidates', { count: run.candidates.length })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onReopen(run.id)}
              data-testid={`discover-reopen-${run.id}`}
              className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
            >
              {t('discover.reopen')}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

import React, { useCallback, useEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { ScreeningCandidate, ScreeningRun, ScreeningStrategy } from '@finagent/core'
import { activeSymbolAtom, addToWatchlistAtom, navSectionAtom, watchlistAtom } from '../../atoms'
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
import { CandidateCard, type CandidateAction } from './CandidateCard'
import { TaskCard } from './TaskCard'

const RESULT_LIMIT = 8

function failureNote(run: ScreeningRun | null): string[] {
  if (!run) return []
  const entries = Object.entries(run.failures)
  if (entries.length === 0) return []
  return entries.map(([id, message]) => `${id}: ${message}`)
}

/**
 * Discover (spec §5–10): task-driven screening. Pick a task → the main
 * process runs the deterministic rule over a bounded universe → candidate
 * cards with [Research] [Compare] [Watch] actions and a previous-runs
 * history.
 */
export const DiscoverView: React.FC = () => {
  const { t } = useTranslation()
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

  const [runsLoading, setRunsLoading] = useState(true)

  const refreshRuns = useCallback(async () => {
    const history = await listScreeningRuns(client)
    setRuns(history)
    setRunsLoading(false)
  }, [client, setRuns])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

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
      } else {
        setError(t('discover.reloadFailed'))
      }
    },
    [client, setError, setLastRun, setResults, t]
  )

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

  const strategyTitle = (id: ScreeningStrategy): string =>
    DISCOVER_TASKS.some((task) => task.id === id) ? t(`discover.strategy.${id}.title`) : id

  const runTitle = lastRun ? strategyTitle(lastRun.strategy) : ''

  const scope =
    watchlist.length > 0
      ? t('discover.scopeWatchlist', { count: watchlist.length })
      : t('discover.scopeUniverse')

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="discover-view">
      <div className="mb-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{t('discover.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-foreground/54">
          {t('discover.subtitle', { scope })}
        </p>
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

      {results && (
        <section className="mt-6" data-testid="discover-results" aria-label={t('discover.resultsAria')}>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
            {runTitle} · {t('discover.candidates', { count: results.length })}
          </h2>
          {failureNote(lastRun).length > 0 && (
            <div
              data-testid="discover-failures"
              className="mb-2 rounded-[8px] border border-[var(--mac-border)] bg-background/40 px-3 py-1.5 text-[11.5px] text-foreground/48"
            >
              {t('discover.dataSourcesUnavailable', { list: failureNote(lastRun).join(' · ') })}
            </div>
          )}
          {results.length === 0 ? (
            <div className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-6 text-center text-[12.5px] text-foreground/48">
              {t('discover.noCandidates')}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(110px,1fr)_auto] gap-3 border-b border-border bg-surface-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/38"><span>{t('discover.candidate')}</span><span className="text-right">{t('discover.metrics')}</span><span className="sr-only">{t('discover.actions')}</span></div>
              {results.map((candidate) => <CandidateCard key={candidate.symbol} candidate={candidate} onAction={handleAction} />)}
            </div>
          )}
        </section>
      )}

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
                    onClick={() => void handleReopen(run.id)}
                    data-testid={`discover-reopen-${run.id}`}
                    className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
                  >
                    {t('discover.reopen')}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

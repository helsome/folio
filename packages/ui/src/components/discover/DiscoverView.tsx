import React, { useCallback, useEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { ScreeningCandidate, ScreeningRun } from '@finagent/core'
import { activeSymbolAtom, addToWatchlistAtom, navSectionAtom, watchlistAtom } from '../../atoms'
import { compareSymbolsAtom } from '../../atoms/compareAtoms'
import {
  DISCOVER_TASKS,
  FAMILY_LABELS,
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
        setError('Screening is not available yet — the screening channel is not wired.')
      }
      setRunning(null)
    },
    [client, running, watchlist, setRunning, setError, setResults, setLastRun, refreshRuns]
  )

  const handleReopen = useCallback(
    async (runId: string) => {
      setError(null)
      const run = await getScreeningRun(client, runId)
      if (run) {
        setLastRun(run)
        setResults(run.candidates)
      } else {
        setError('Could not reload that run.')
      }
    },
    [client, setError, setLastRun, setResults]
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

  const runTitle = lastRun
    ? (DISCOVER_TASKS.find((task) => task.id === lastRun.strategy)?.title ?? lastRun.strategy)
    : ''

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="discover-view">
      <div className="mb-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Discover</h1>
        <p className="mt-0.5 text-[12.5px] text-foreground/54">
          Pick a task to screen{' '}
          {watchlist.length > 0
            ? `your watchlist (${watchlist.length} symbols)`
            : 'the built-in universe'}
          {' \u2014 '}deterministic rules over live market data, no AI scanning.
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
          <section key={family} data-testid={`discover-family-${family}`} aria-label={FAMILY_LABELS[family]}>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
              {FAMILY_LABELS[family]}
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
        <section className="mt-6" data-testid="discover-results" aria-label="Screening results">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
            {runTitle} · {results.length} candidate{results.length === 1 ? '' : 's'}
          </h2>
          {failureNote(lastRun).length > 0 && (
            <div
              data-testid="discover-failures"
              className="mb-2 rounded-[8px] border border-[var(--mac-border)] bg-background/40 px-3 py-1.5 text-[11.5px] text-foreground/48"
            >
              Data sources unavailable this run: {failureNote(lastRun).join(' · ')}
            </div>
          )}
          {results.length === 0 ? (
            <div className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-6 text-center text-[12.5px] text-foreground/48">
              No candidates matched this task in the current universe.
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((candidate) => (
                <CandidateCard key={candidate.symbol} candidate={candidate} onAction={handleAction} />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mt-6" data-testid="discover-history" aria-label="Previous runs">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/56">
          Previous runs
        </h2>
        {runsLoading ? (
          <div className="py-4 text-center text-[12.5px] text-foreground/40">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--mac-border)] bg-background/40 px-3 py-4 text-center text-[12.5px] text-foreground/48">
            No screening runs yet.
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
                      {task?.title ?? run.strategy}
                    </div>
                    <div className="text-[11.5px] text-foreground/44">
                      {new Date(run.createdAt).toLocaleString()} · {run.candidates.length} candidates
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleReopen(run.id)}
                    data-testid={`discover-reopen-${run.id}`}
                    className="shrink-0 rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
                  >
                    Reopen
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

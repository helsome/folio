import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { ResearchRunSummary, ResearchReport } from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import {
  researchRunsAtom,
  researchReportAtom,
  researchLoadingAtom,
  startResearch,
  cancelResearch,
  loadResearchRuns,
  loadResearchRun,
  loadSymbolReports,
  loadResearchReport,
  TERMINAL_RUN_STATUSES,
} from '../../atoms/researchAtoms';
import { ResearchReportView } from './ResearchReportView';

const POLL_MS = 900;

/** Deep Research entry: run history for the focused symbol + start/cancel + report. */
export const ResearchPanel: React.FC = () => {
  const symbol = useAtomValue(activeSymbolAtom);
  const [runs, setRuns] = useAtom(researchRunsAtom);
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [report, setReport] = useAtom(researchReportAtom);
  const [loading, setLoading] = useAtom(researchLoadingAtom);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadResearchRuns().then(setRuns);
  }, [setRuns]);

  useEffect(() => {
    if (!symbol) {
      setReports([]);
      setReport(null);
      return;
    }
    void loadSymbolReports(symbol).then(setReports);
    const latest = runs.find((run) => run.symbol === symbol && run.reportId);
    if (latest?.reportId && !report) {
      void loadResearchReport(latest.reportId).then((loaded) => {
        if (loaded) setReport(loaded);
      });
    }
  }, [symbol, setReport, setReports, runs, report]);

  // Poll the newest active run for this symbol while it is non-terminal.
  const activeRun = runs.find(
    (run) => run.symbol === symbol && !(run.status in TERMINAL_RUN_STATUSES)
  );
  useEffect(() => {
    if (!activeRun) return;
    let alive = true;
    const timer = setInterval(async () => {
      const updated = await loadResearchRun(activeRun.id);
      if (!alive || !updated) return;
      setRuns((current) => {
        const next = [updated, ...current.filter((run) => run.id !== updated.id)];
        return next;
      });
      if (updated.status in TERMINAL_RUN_STATUSES && updated.reportId) {
        const loaded = await loadResearchReport(updated.reportId);
        if (alive && loaded) {
          setReport(loaded);
          void loadSymbolReports(updated.symbol).then(setReports);
        }
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeRun?.id, setRuns, setReport]);

  const handleStart = async () => {
    if (!symbol || loading || activeRun) return;
    setLoading(true);
    setError(null);
    try {
      const started = await startResearch(symbol);
      if (started) {
        setRuns((current) => [started, ...current.filter((run) => run.id !== started.id)]);
      } else {
        setError('Deep Research is not available yet.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    await cancelResearch(activeRun.id);
  };

  const symbolRuns = runs.filter((run) => run.symbol === symbol);

  return (
    <div className="flex h-full flex-col" data-testid="research-panel">
      <div className="flex items-center justify-between border-b mac-section-divider px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Deep Research</h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {symbol
              ? `Structured research for ${symbol} — facts from the capability layer, synthesis by the agent.`
              : 'Open a symbol from the watchlist to start research.'}
          </p>
        </div>
        {symbol && (
          <div className="flex items-center gap-2">
            {activeRun && (
              <button
                onClick={() => void handleCancel()}
                className="mac-secondary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold"
              >
                Stop
              </button>
            )}
            <button
              onClick={() => void handleStart()}
              disabled={!symbol || loading || Boolean(activeRun)}
              className="mac-primary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-45"
            >
              {loading ? 'Starting…' : 'Deep Research'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="px-4 pt-3 text-[12.5px] text-negative">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {activeRun && (
          <RunProgressCard key={activeRun.id} run={activeRun} />
        )}

        {report && symbol && report.symbol === symbol && (
          <ResearchReportView report={report} />
        )}

        {symbol && !activeRun && !report && (
          <RunHistory
            runs={symbolRuns}
            onSelect={async (reportId) => {
              const loaded = await loadResearchReport(reportId);
              if (loaded) setReport(loaded);
            }}
          />
        )}

        {!symbol && <EmptyState />}
      </div>
    </div>
  );
};

const RunProgressCard: React.FC<{ run: ResearchRunSummary }> = ({ run }) => {
  const planned = run.plannedCapabilities.length;
  const done = run.completedCapabilities.length;
  const failed = run.failedCapabilities.length;
  return (
    <div className="mb-3 rounded-[10px] border mac-list-row p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-foreground">
          {run.status === 'fetching' ? 'Fetching market data…' : 'Synthesizing report…'}
        </span>
        <span className="tnum text-[11px] text-text-muted">
          {done}/{planned} capabilities
          {failed > 0 ? ` (${failed} failed)` : ''}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${planned === 0 ? 100 : Math.round((done / planned) * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {run.plannedCapabilities.map((capabilityId) => {
          const doneCap = run.completedCapabilities.includes(capabilityId);
          const failedCap = run.failedCapabilities.includes(capabilityId);
          return (
            <span
              key={capabilityId}
              className={`rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-medium ${
                doneCap
                  ? 'bg-positive/12 text-positive'
                  : failedCap
                    ? 'bg-negative/12 text-negative'
                    : 'bg-foreground/8 text-text-muted'
              }`}
            >
              {capabilityId}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const RunHistory: React.FC<{
  runs: ResearchRunSummary[];
  onSelect: (reportId: string) => void;
}> = ({ runs, onSelect }) => {
  if (runs.length === 0) return <EmptyState />;
  return (
    <div className="flex flex-col gap-1.5">
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => {
            if (run.reportId) onSelect(run.reportId);
          }}
          className="mac-list-row flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left"
        >
          <span className="text-[12.5px] font-semibold text-foreground">{run.symbol}</span>
          <span className="tnum text-[11px] text-text-muted">
            {run.status}
            {run.finishedAt ? ` · ${new Date(run.finishedAt).toLocaleTimeString()}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="py-10 text-center text-[12px] text-text-muted">
    No research yet. Pick a symbol and start Deep Research.
  </div>
);

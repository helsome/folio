import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type {
  EvaluationExperiment,
  EvaluationResultRecord,
  EvaluationRun,
} from '@finagent/core';
import { useFinagentClient, type EvaluationExperimentDetail } from '../../client';
import { Button } from '../primitives/Button';
import { failureModeLabel, formatDate, metricKindLabel, metricLabel, scorePercent, shortSha } from './format';
import type { CaseRef } from './EvaluationCenter';

/**
 * Experiment summary (spec §65–66): per-metric scores with sample counts,
 * failure modes, run list with verdicts, and per-run LangSmith trace links.
 */

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const VERDICT_STYLE: Record<EvaluationResultRecord['verdict'], string> = {
  pass: 'text-[var(--mac-green)] border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10',
  fail: 'text-destructive border-destructive/30 bg-destructive/10',
  partial: 'text-[var(--mac-yellow)] border-[var(--mac-yellow)]/40 bg-[var(--mac-yellow)]/10',
  'not-applicable': 'text-foreground/50 border-border bg-surface-muted',
};

export const ExperimentDetail: React.FC<{
  experimentId: string;
  detail: EvaluationExperimentDetail | null;
  onLoadDetail: () => void;
  onBack: () => void;
  onOpenCase: (caseRef: CaseRef) => void;
}> = ({ experimentId, detail, onLoadDetail, onBack, onOpenCase }) => {
  const client = useFinagentClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) return;
    setLoading(true);
    setError(null);
    void (async () => {
      await onLoadDetail();
      setLoading(false);
    })();
  }, [detail, onLoadDetail]);

  const openTrace = (url: string): void => {
    void client.openExternal?.(url);
  };

  if (loading || (detail === null && !error)) {
    return (
      <div className="flex h-full flex-col" data-testid="experiment-detail">
        <div className="border-b mac-section-divider px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
        <div className="flex items-center gap-2 p-4 text-[12px] text-foreground/48">
          <Spinner /> Loading experiment…
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col" data-testid="experiment-detail">
        <div className="border-b mac-section-divider px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          {error ?? `Experiment ${experimentId} could not be loaded.`}
        </div>
      </div>
    );
  }

  const { experiment, runs, results } = detail;
  const summary = experiment.summary;
  const resultByRun = new Map(results.map((result) => [result.runId, result]));
  const resultByCase = new Map(results.map((result) => [result.caseId, result]));

  const metaRows: Array<{ label: string; value: string }> = [
    { label: 'Dataset', value: `${experiment.datasetId} v${experiment.datasetVersion}` },
    { label: 'Model', value: `${experiment.config.provider ?? '—'} / ${experiment.config.model ?? '—'}` },
    { label: 'Judge', value: `${experiment.config.judgeProvider ?? '—'} / ${experiment.config.judgeModel ?? '—'}` },
    { label: 'Thinking level', value: experiment.config.thinkingLevel ?? '—' },
    { label: 'Started', value: formatDate(experiment.startedAt) },
    { label: 'Completed', value: formatDate(experiment.completedAt) },
    { label: 'Git sha', value: shortSha(experiment.metadata.gitSha) },
    { label: 'Runs', value: summary ? `${summary.completedRuns} / ${summary.totalRuns} completed` : String(runs.length) },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="experiment-detail">
      <header className="flex items-center justify-between border-b mac-section-divider px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{experiment.name}</h2>
            <p className="mt-0.5 text-[11px] text-foreground/48">
              {experiment.datasetId} v{experiment.datasetVersion} · {formatDate(experiment.startedAt)}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
            experiment.status === 'completed'
              ? 'text-[var(--mac-green)] border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10'
              : 'text-foreground/56 border-border bg-surface-muted'
          }`}
        >
          {experiment.status}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl space-y-4">
          <div className="mac-stock-tile rounded-[14px] p-5">
            <h3 className="text-[13px] font-semibold text-foreground">Configuration</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {metaRows.map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <dt className="text-[10.5px] uppercase tracking-wide text-foreground/40">{row.label}</dt>
                  <dd className="truncate text-[12.5px] font-medium text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {summary && (
            <div className="mac-stock-tile rounded-[14px] p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-semibold text-foreground">Metric scores</h3>
                <span className="text-[12px] font-semibold tabular-nums text-foreground">
                  Composite {scorePercent(summary.compositeScore)} · Pass rate {scorePercent(summary.passRate)}
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b mac-section-divider">
                      <th className="py-2 pr-3 text-left font-medium text-foreground/54">Metric</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground/54">Kind</th>
                      <th className="px-3 py-2 text-right font-medium text-foreground/54">Score</th>
                      <th className="px-3 py-2 text-right font-medium text-foreground/54">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.metricAggregates.map((aggregate) => (
                      <tr key={aggregate.metric} className="border-b mac-section-divider last:border-0">
                        <td className="py-2 pr-3 text-foreground">{metricLabel(aggregate.metric)}</td>
                        <td className="px-3 py-2 text-foreground/48">{metricKindLabel(aggregate.metric)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                          {scorePercent(aggregate.score)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/54">
                          {aggregate.sampleCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {summary && summary.failureModes.length > 0 && (
            <div className="mac-stock-tile rounded-[14px] p-5">
              <h3 className="text-[13px] font-semibold text-foreground">Failure modes</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...summary.failureModes]
                  .sort((a, b) => b.count - a.count)
                  .map((entry) => (
                    <span
                      key={entry.mode}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-foreground/70"
                    >
                      {failureModeLabel(entry.mode)} <span className="font-semibold tabular-nums text-foreground">{entry.count}</span>
                      <span className="text-foreground/36">/ {entry.sampleCount}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="mac-stock-tile rounded-[14px] p-5">
            <h3 className="text-[13px] font-semibold text-foreground">Runs</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" data-testid="runs-table">
                <thead>
                  <tr className="border-b mac-section-divider">
                    <th className="py-2 pr-3 text-left font-medium text-foreground/54">Case</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground/54">Status</th>
                    <th className="px-3 py-2 text-right font-medium text-foreground/54">Verdict</th>
                    <th className="px-3 py-2 text-right font-medium text-foreground/54">Latency</th>
                    <th className="px-3 py-2 text-right font-medium text-foreground/54">Tools</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground/54">Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const result = resultByRun.get(run.id) ?? resultByCase.get(run.caseId);
                    return (
                      <tr key={run.id} className="border-b mac-section-divider last:border-0">
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => onOpenCase({ experimentId: experiment.id, caseId: run.caseId })}
                            className="font-mono text-accent hover:underline"
                          >
                            {run.caseId}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-foreground/64">{run.status}</td>
                        <td className="px-3 py-2 text-right">
                          {result && (
                            <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${VERDICT_STYLE[result.verdict]}`}>
                              {result.verdict}
                            </span>
                          )}
                          {!result && <span className="text-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/64">
                          {run.latencyMs != null ? `${run.latencyMs}ms` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/64">{run.toolCalls.length}</td>
                        <td className="px-3 py-2">
                          {run.traceRef?.url ? (
                            <button
                              type="button"
                              onClick={() => openTrace(run.traceRef!.url!)}
                              className="inline-flex items-center gap-1 text-accent hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> LangSmith
                            </button>
                          ) : (
                            <span className="text-foreground/30">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
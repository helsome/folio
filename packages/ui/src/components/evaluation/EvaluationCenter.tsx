import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import type {
  EvaluationBaseline,
  EvaluationExperiment,
} from '@finagent/core';
import { useFinagentClient, type EvaluationExperimentDetail } from '../../client';
import { Button } from '../primitives/Button';
import {
  buildModelMetricRows,
  experimentModelLabel,
  failureModeLabel,
  formatDate,
  groupExperimentsByModel,
  metricKindLabel,
  metricLabel,
  regressionFor,
  regressionText,
  scorePercent,
  shortSha,
} from './format';
import { ExperimentDetail } from './ExperimentDetail';
import { CaseDetail } from './CaseDetail';
import { FailureModesTab } from './FailureModesTab';

/**
 * Evaluation Center (spec §64–69) — internal/advanced tool for reviewing
 * benchmark experiments: overview, experiment list + summary, model
 * comparison (only real metrics, spec §67), failure-mode drill-down, and the
 * per-case detail with human feedback (spec §82). Deliberately compact — this
 * is not a mini-LangSmith (spec §129).
 */

type InternalTab = 'overview' | 'experiments' | 'model-comparison' | 'failure-modes';

const TAB_LABELS: Array<{ id: InternalTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'model-comparison', label: 'Model Comparison' },
  { id: 'failure-modes', label: 'Failure Modes' },
];

export interface CaseRef {
  experimentId: string;
  caseId: string;
}

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const EvaluationCenter: React.FC = () => {
  const client = useFinagentClient();
  const [experiments, setExperiments] = useState<EvaluationExperiment[]>([]);
  const [baselines, setBaselines] = useState<EvaluationBaseline[]>([]);
  const [details, setDetails] = useState<Record<string, EvaluationExperimentDetail>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<InternalTab>('overview');
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseRef | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [experimentsResult, baselinesResult] = await Promise.all([
      client.evaluation?.listExperiments(),
      client.evaluation?.listBaselines(),
    ]);
    if (experimentsResult?.ok) setExperiments(experimentsResult.data);
    else setLoadError(experimentsResult?.error.message ?? 'Failed to load experiments.');
    if (baselinesResult?.ok) setBaselines(baselinesResult.data);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openExperiment = useCallback((experimentId: string) => {
    setSelectedExperimentId(experimentId);
    setSelectedCase(null);
  }, []);

  const openCase = useCallback((caseRef: CaseRef) => {
    setSelectedCase(caseRef);
    setSelectedExperimentId(null);
  }, []);

  const loadDetail = useCallback(
    async (experimentId: string): Promise<EvaluationExperimentDetail | null> => {
      if (details[experimentId]) return details[experimentId];
      const result = await client.evaluation?.getExperiment(experimentId);
      if (result?.ok) {
        const data = result.data;
        if (data) {
          setDetails((current) => {
            const next = { ...current };
            next[experimentId] = data;
            return next;
          });
          return data;
        }
      }
      return null;
    },
    [client, details]
  );

  if (selectedCase) {
    return (
      <CaseDetail
        caseRef={selectedCase}
        detail={details[selectedCase.experimentId] ?? null}
        onLoadDetail={() => void loadDetail(selectedCase.experimentId)}
        onBack={() => setSelectedCase(null)}
      />
    );
  }

  if (selectedExperimentId) {
    return (
      <ExperimentDetail
        experimentId={selectedExperimentId}
        detail={details[selectedExperimentId] ?? null}
        onLoadDetail={() => void loadDetail(selectedExperimentId)}
        onBack={() => setSelectedExperimentId(null)}
        onOpenCase={openCase}
      />
    );
  }

  const latestCompleted = useMemo(
    () => experiments.find((experiment) => experiment.status === 'completed'),
    [experiments]
  );

  return (
    <div className="flex h-full flex-col" data-testid="evaluation-center">
      <header className="flex items-center justify-between border-b mac-section-divider px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Evaluation Center</h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            Benchmark results for the agent engineering loop — internal tool.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <div className="mb-3 flex gap-1 border-b border-border">
          {TAB_LABELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-smooth ${
                tab === entry.id
                  ? 'bg-foreground/8 text-foreground'
                  : 'text-foreground/52 hover:text-foreground'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {loading && !loadError ? (
          <div className="flex items-center gap-2 text-[12px] text-foreground/48">
            <Spinner /> Loading experiments…
          </div>
        ) : loadError && experiments.length === 0 ? (
          <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
            {loadError}
            <button
              type="button"
              onClick={() => void refresh()}
              className="ml-2 text-accent underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab experiment={latestCompleted} baselines={baselines} onViewSummary={openExperiment} />
            )}
            {tab === 'experiments' && <ExperimentsTab experiments={experiments} baselines={baselines} onViewSummary={openExperiment} />}
            {tab === 'model-comparison' && <ModelComparisonTab experiments={experiments} />}
            {tab === 'failure-modes' && (
              <FailureModesTab
                experiments={experiments}
                details={details}
                onLoadDetail={loadDetail}
                onOpenCase={openCase}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Overview (spec §65, §111) ───────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="mac-stock-tile rounded-[14px] p-4">
    <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/44">{label}</p>
    <p className="mt-1.5 text-[22px] font-semibold tabular-nums text-foreground">{value}</p>
    {sub && <p className="mt-1 text-[11px] text-foreground/44">{sub}</p>}
  </div>
);

const FailureModeTag: React.FC<{ mode: string; count: number }> = ({ mode, count }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-foreground/70">
    {mode} <span className="font-semibold tabular-nums text-foreground">{count}</span>
  </span>
);

const OverviewTab: React.FC<{
  experiment: EvaluationExperiment | undefined;
  baselines: EvaluationBaseline[];
  onViewSummary: (experimentId: string) => void;
}> = ({ experiment, baselines, onViewSummary }) => {
  if (!experiment) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        No completed experiments yet — run an evaluation from the CLI to see results here.
      </div>
    );
  }
  const summary = experiment.summary;
  if (!summary) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        Latest experiment “{experiment.name}” has no summary yet.
      </div>
    );
  }
  const regression = regressionFor(experiment, baselines);

  const topFailure = [...summary.failureModes].sort((a, b) => b.count - a.count)[0];
  const passRate = summary.completedRuns > 0 ? summary.passRate : null;

  return (
    <div className="space-y-4" data-testid="overview-tab">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/44">
            Latest experiment
          </p>
          <h3 className="mt-0.5 text-[16px] font-semibold text-foreground">{experiment.name}</h3>
          <p className="mt-0.5 text-[11.5px] text-foreground/48">
            {experiment.datasetId} v{experiment.datasetVersion} · {experimentModelLabel(experiment)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onViewSummary(experiment.id)}>
          View Summary <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Cases" value={String(summary.totalRuns)} sub={`${summary.completedRuns} completed`} />
        <StatCard
          label="Pass rate"
          value={passRate === null ? '—' : scorePercent(passRate)}
          sub={`${summary.completedRuns} runs scored`}
        />
        <StatCard
          label="Composite"
          value={scorePercent(summary.compositeScore)}
          sub={regression?.compositeDelta != null ? `${regression.compositeDelta >= 0 ? '+' : ''}${regression.compositeDelta.toFixed(2)} vs baseline` : 'no baseline'}
        />
        <StatCard
          label="Top failure mode"
          value={topFailure ? failureModeLabel(topFailure.mode) : '—'}
          sub={topFailure ? `${topFailure.count} run(s)` : 'no failures'}
        />
      </div>

      <div className="mac-stock-tile rounded-[14px] p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-foreground">Per-metric breakdown</h4>
          <span className="text-[11px] text-foreground/42">
            Always shown alongside the composite (spec §111)
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

      {summary.failureModes.length > 0 && (
        <div className="mac-stock-tile rounded-[14px] p-5">
          <h4 className="text-[13px] font-semibold text-foreground">Failure modes</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...summary.failureModes]
              .sort((a, b) => b.count - a.count)
              .map((entry) => (
                <FailureModeTag key={entry.mode} mode={failureModeLabel(entry.mode)} count={entry.count} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Experiments (spec §65) ─────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  completed: { label: 'completed', className: 'text-[var(--mac-green)] border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10' },
  running: { label: 'running', className: 'text-accent border-accent/30 bg-accent/10' },
  queued: { label: 'queued', className: 'text-foreground/56 border-border bg-surface-muted' },
  failed: { label: 'failed', className: 'text-destructive border-destructive/30 bg-destructive/10' },
  cancelled: { label: 'cancelled', className: 'text-foreground/56 border-border bg-surface-muted' },
};

const ExperimentsTab: React.FC<{
  experiments: EvaluationExperiment[];
  baselines: EvaluationBaseline[];
  onViewSummary: (experimentId: string) => void;
}> = ({ experiments, baselines, onViewSummary }) => {
  if (experiments.length === 0) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        No experiments recorded yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-foreground/44">
        {experiments.length} experiment(s), newest first. Sample counts are shown wherever a score
        appears.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="experiments-table">
          <thead>
            <tr className="border-b mac-section-divider">
              <th className="py-2 pr-3 text-left font-medium text-foreground/54">Name</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">Dataset</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">Model</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">Git</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">Date</th>
              <th className="px-3 py-2 text-right font-medium text-foreground/54">Score</th>
              <th className="px-3 py-2 text-right font-medium text-foreground/54">Regression</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">Status</th>
              <th className="py-2 pl-3 text-right font-medium text-foreground/54">Actions</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((experiment) => {
              const status = STATUS_LABEL[experiment.status] ?? STATUS_LABEL.queued;
              return (
                <tr key={experiment.id} className="border-b mac-section-divider last:border-0">
                  <td className="py-2 pr-3 font-medium text-foreground">{experiment.name}</td>
                  <td className="px-3 py-2 text-foreground/64">
                    {experiment.datasetId} <span className="text-foreground/36">v{experiment.datasetVersion}</span>
                  </td>
                  <td className="px-3 py-2 text-foreground/72">{experimentModelLabel(experiment)}</td>
                  <td className="px-3 py-2 font-mono text-foreground/54">{shortSha(experiment.metadata.gitSha)}</td>
                  <td className="px-3 py-2 text-foreground/54">{formatDate(experiment.startedAt)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {scorePercent(experiment.summary?.compositeScore)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground/64">
                    {regressionText(experiment, baselines)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <Button variant="secondary" size="sm" onClick={() => onViewSummary(experiment.id)}>
                      View Summary
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Model comparison (spec §67) ────────────────────────────────────────────

const ModelComparisonTab: React.FC<{ experiments: EvaluationExperiment[] }> = ({ experiments }) => {
  const groups = useMemo(() => groupExperimentsByModel(experiments), [experiments]);
  const rows = useMemo(() => buildModelMetricRows(groups), [groups]);

  if (groups.length === 0) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        No completed experiments to compare yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-foreground/44">
        Completed experiments grouped by model. Only metrics that actually have data appear;
        empty cells mean the metric was not scored for that model.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="model-comparison-table">
          <thead>
            <tr className="border-b mac-section-divider">
              <th className="py-2 pr-3 text-left font-medium text-foreground/54">Metric</th>
              {groups.map((group) => (
                <th key={group.key} className="px-3 py-2 text-left font-medium text-foreground/54">
                  {group.label}
                  <div className="mt-0.5 text-[10px] font-normal text-foreground/36">
                    {group.experiments.length} experiment(s)
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metricId} className="border-b mac-section-divider last:border-0">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{row.label}</div>
                  {row.kind && <div className="text-[10px] text-foreground/40">{row.kind}</div>}
                </td>
                {row.cells.map((cell, index) => (
                  <td key={index} className="px-3 py-2 align-top">
                    {cell ? (
                      <>
                        <span className="font-medium tabular-nums text-foreground">
                          {scorePercent(cell.score)}
                        </span>
                        <span className="ml-1.5 text-[10px] text-foreground/40">
                          n={cell.sampleCount}
                        </span>
                      </>
                    ) : (
                      <span className="text-foreground/30">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
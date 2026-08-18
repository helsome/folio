import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const TAB_LABELS: Array<{ id: InternalTab; labelKey: string }> = [
  { id: 'overview', labelKey: 'evaluation.overview' },
  { id: 'experiments', labelKey: 'evaluation.experiments' },
  { id: 'model-comparison', labelKey: 'evaluation.modelComparison' },
  { id: 'failure-modes', labelKey: 'evaluation.failureModes' },
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
  const { t } = useTranslation();
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
    else setLoadError(experimentsResult?.error.message ?? t('evaluation.loadExperimentsFailed'));
    if (baselinesResult?.ok) setBaselines(baselinesResult.data);
    setLoading(false);
  }, [client, t]);

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
          <h2 className="text-[15px] font-semibold text-foreground">{t('evaluation.center')}</h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">{t('evaluation.centerDescription')}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh()}>
          {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('evaluation.refresh')}
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
              {t(entry.labelKey)}
            </button>
          ))}
        </div>

        {loading && !loadError ? (
          <div className="flex items-center gap-2 text-[12px] text-foreground/48">
            <Spinner /> {t('evaluation.loadingExperiments')}
          </div>
        ) : loadError && experiments.length === 0 ? (
          <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
            {loadError}
            <button
              type="button"
              onClick={() => void refresh()}
              className="ml-2 text-accent underline underline-offset-2"
            >
              {t('evaluation.retry')}
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
  const { t } = useTranslation();
  if (!experiment) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        {t('evaluation.noCompletedExperiments')}
      </div>
    );
  }
  const summary = experiment.summary;
  if (!summary) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        {t('evaluation.latestExperimentNoSummary', { name: experiment.name })}
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
            {t('evaluation.latestExperiment')}
          </p>
          <h3 className="mt-0.5 text-[16px] font-semibold text-foreground">{experiment.name}</h3>
          <p className="mt-0.5 text-[11.5px] text-foreground/48">
            {experiment.datasetId} v{experiment.datasetVersion} · {experimentModelLabel(experiment)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onViewSummary(experiment.id)}>
          {t('evaluation.viewSummary')} <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('evaluation.cases')} value={String(summary.totalRuns)} sub={t('evaluation.completedCount', { count: summary.completedRuns })} />
        <StatCard
          label={t('evaluation.passRate')}
          value={passRate === null ? '—' : scorePercent(passRate)}
          sub={t('evaluation.runsScored', { count: summary.completedRuns })}
        />
        <StatCard
          label={t('evaluation.composite')}
          value={scorePercent(summary.compositeScore)}
          sub={
            regression?.compositeDelta != null
              ? t('evaluation.vsBaseline', { delta: regression.compositeDelta >= 0 ? `+${regression.compositeDelta.toFixed(2)}` : regression.compositeDelta.toFixed(2) })
              : t('evaluation.noBaseline')
          }
        />
        <StatCard
          label={t('evaluation.topFailureMode')}
          value={topFailure ? t(failureModeLabel(topFailure.mode)) : '—'}
          sub={topFailure ? t('evaluation.runsCount', { count: topFailure.count }) : t('evaluation.noFailures')}
        />
      </div>

      <div className="mac-stock-tile rounded-[14px] p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-foreground">{t('evaluation.perMetricBreakdown')}</h4>
          <span className="text-[11px] text-foreground/42">
            {t('evaluation.breakdownNote')}
          </span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b mac-section-divider">
                <th className="py-2 pr-3 text-left font-medium text-foreground/54">{t('evaluation.metric')}</th>
                <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.kind')}</th>
                <th className="px-3 py-2 text-right font-medium text-foreground/54">{t('evaluation.score')}</th>
                <th className="px-3 py-2 text-right font-medium text-foreground/54">{t('evaluation.samples')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.metricAggregates.map((aggregate) => (
                <tr key={aggregate.metric} className="border-b mac-section-divider last:border-0">
                  <td className="py-2 pr-3 text-foreground">{t(metricLabel(aggregate.metric))}</td>
                  <td className="px-3 py-2 text-foreground/48">{metricKindLabel(aggregate.metric) !== null ? t(metricKindLabel(aggregate.metric) as string) : '—'}</td>
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
          <h4 className="text-[13px] font-semibold text-foreground">{t('evaluation.failureModes')}</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...summary.failureModes]
              .sort((a, b) => b.count - a.count)
              .map((entry) => (
                <FailureModeTag key={entry.mode} mode={t(failureModeLabel(entry.mode))} count={entry.count} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Experiments (spec §65) ─────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { labelKey: string; className: string }> = {
  completed: { labelKey: 'evaluation.statusCompleted', className: 'text-[var(--mac-green)] border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10' },
  running: { labelKey: 'evaluation.statusRunning', className: 'text-accent border-accent/30 bg-accent/10' },
  queued: { labelKey: 'evaluation.statusQueued', className: 'text-foreground/56 border-border bg-surface-muted' },
  failed: { labelKey: 'evaluation.statusFailed', className: 'text-destructive border-destructive/30 bg-destructive/10' },
  cancelled: { labelKey: 'evaluation.statusCancelled', className: 'text-foreground/56 border-border bg-surface-muted' },
};

const ExperimentsTab: React.FC<{
  experiments: EvaluationExperiment[];
  baselines: EvaluationBaseline[];
  onViewSummary: (experimentId: string) => void;
}> = ({ experiments, baselines, onViewSummary }) => {
  const { t } = useTranslation();
  if (experiments.length === 0) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        {t('evaluation.noExperimentsRecorded')}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-foreground/44">
        {t('evaluation.experimentsIntro', { count: experiments.length })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="experiments-table">
          <thead>
            <tr className="border-b mac-section-divider">
              <th className="py-2 pr-3 text-left font-medium text-foreground/54">{t('evaluation.name')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.dataset')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.model')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.git')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.date')}</th>
              <th className="px-3 py-2 text-right font-medium text-foreground/54">{t('evaluation.score')}</th>
              <th className="px-3 py-2 text-right font-medium text-foreground/54">{t('evaluation.regressionColumn')}</th>
              <th className="px-3 py-2 text-left font-medium text-foreground/54">{t('evaluation.status')}</th>
              <th className="py-2 pl-3 text-right font-medium text-foreground/54">{t('evaluation.actions')}</th>
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
                      {t(status.labelKey)}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <Button variant="secondary" size="sm" onClick={() => onViewSummary(experiment.id)}>
                      {t('evaluation.viewSummary')}
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
  const { t } = useTranslation();
  const groups = useMemo(() => groupExperimentsByModel(experiments), [experiments]);
  const rows = useMemo(() => buildModelMetricRows(groups), [groups]);

  if (groups.length === 0) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        {t('evaluation.noCompletedToCompare')}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-foreground/44">
        {t('evaluation.modelComparisonIntro')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid="model-comparison-table">
          <thead>
            <tr className="border-b mac-section-divider">
              <th className="py-2 pr-3 text-left font-medium text-foreground/54">{t('evaluation.metric')}</th>
              {groups.map((group) => (
                <th key={group.key} className="px-3 py-2 text-left font-medium text-foreground/54">
                  {group.label}
                  <div className="mt-0.5 text-[10px] font-normal text-foreground/36">
                    {t('evaluation.experimentCount', { count: group.experiments.length })}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metricId} className="border-b mac-section-divider last:border-0">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{t(row.label)}</div>
                  {row.kind && <div className="text-[10px] text-foreground/40">{t(row.kind)}</div>}
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
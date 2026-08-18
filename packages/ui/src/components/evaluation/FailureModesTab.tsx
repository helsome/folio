import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EvaluationExperiment,
  EvaluationFailureMode,
} from '@finagent/core';
import type { EvaluationExperimentDetail } from '../../client';
import { failureModeLabel } from './format';
import type { CaseRef } from './EvaluationCenter';

/**
 * Failure modes (spec §66): failure taxonomy counts filtered by experiment,
 * with per-case drill-down. Aggregates are computed from the loaded experiment
 * details (runs + evaluation records), never invented.
 */

interface FailureRow {
  mode: EvaluationFailureMode;
  count: number;
  cases: Array<{ experimentId: string; caseId: string; verdict: string | null; runStatus: string }>;
}

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const VERDICT_CLASS: Record<string, string> = {
  pass: 'bg-[var(--mac-green)]/10 text-[var(--mac-green)]',
  fail: 'bg-destructive/10 text-destructive',
  partial: 'bg-[var(--mac-yellow)]/10 text-[var(--mac-yellow)]',
};

const RUN_STATUS_KEY: Record<string, string> = {
  completed: 'evaluation.runStatuses.completed',
  failed: 'evaluation.runStatuses.failed',
  cancelled: 'evaluation.runStatuses.cancelled',
  timeout: 'evaluation.runStatuses.timeout',
  skipped: 'evaluation.runStatuses.skipped',
};

function aggregateFailures(list: EvaluationExperimentDetail[]): FailureRow[] {
  const byMode = new Map<EvaluationFailureMode, FailureRow>();
  for (const detail of list) {
    for (const run of detail.runs) {
      for (const mode of run.failureModes) {
        let row = byMode.get(mode);
        if (!row) {
          row = { mode, count: 0, cases: [] };
          byMode.set(mode, row);
        }
        row.count += 1;
        row.cases.push({
          experimentId: detail.experiment.id,
          caseId: run.caseId,
          verdict: detail.results.find((result) => result.caseId === run.caseId)?.verdict ?? null,
          runStatus: run.status,
        });
      }
    }
  }
  return [...byMode.values()].sort((a, b) => b.count - a.count);
}

export const FailureModesTab: React.FC<{
  experiments: EvaluationExperiment[];
  details: Record<string, EvaluationExperimentDetail>;
  onLoadDetail: (experimentId: string) => Promise<EvaluationExperimentDetail | null>;
  onOpenCase: (caseRef: CaseRef) => void;
}> = ({ experiments, details, onLoadDetail, onOpenCase }) => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<string>('all');
  const [caseQuery, setCaseQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the details needed for the current scope ('all' → every experiment).
  useEffect(() => {
    void (async () => {
      const needed = scope === 'all' ? experiments.map((entry) => entry.id) : [scope];
      const missing = needed.filter((id) => !details[id]);
      if (missing.length === 0) return;
      setLoading(true);
      setLoadError(null);
      const settled = await Promise.allSettled(missing.map((id) => onLoadDetail(id)));
      const failed = settled.filter((entry) => entry.status === 'rejected').length;
      if (failed > 0) setLoadError(t('evaluation.couldNotLoadDetails', { count: failed }));
      setLoading(false);
    })();
  }, [scope, experiments, details, onLoadDetail]);

  const rows = useMemo(() => {
    const list =
      scope === 'all'
        ? experiments
            .filter((entry) => details[entry.id])
            .map((entry) => details[entry.id])
        : details[scope]
          ? [details[scope]]
          : [];
    const query = caseQuery.trim().toLowerCase();
    const all = aggregateFailures(list);
    if (!query) return all;
    return all
      .map((row) => ({
        ...row,
        cases: row.cases.filter((entry) => entry.caseId.toLowerCase().includes(query)),
      }))
      .filter((row) => row.cases.length > 0);
  }, [scope, details, experiments, caseQuery]);

  const totalFailures = useMemo(() => rows.reduce((sum, row) => sum + row.count, 0), [rows]);

  const failureCountFor = (experiment: EvaluationExperiment): number =>
    experiment.summary?.failureModes.reduce((sum, entry) => sum + entry.count, 0) ?? 0;

  if (experiments.length === 0) {
    return (
      <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
        {t('evaluation.noExperimentsToInspect')}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="failure-modes-tab">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setScope('all')}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-smooth ${
            scope === 'all'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border text-foreground/56 hover:text-foreground'
          }`}
        >
          {t('evaluation.allExperiments')}
        </button>
        {experiments.map((experiment) => (
          <button
            key={experiment.id}
            type="button"
            onClick={() => setScope(experiment.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-smooth ${
              scope === experiment.id
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-foreground/56 hover:text-foreground'
            }`}
          >
            <span className="max-w-[180px] truncate">{experiment.name}</span>
            <span className="tabular-nums text-foreground/40">{failureCountFor(experiment)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-foreground/44">
          {loading ? t('evaluation.loadingDetails') : t('evaluation.failureSummary', { modes: rows.length, failures: totalFailures })}
        </p>
        <input
          className="mac-input h-8 w-56 rounded-[10px] px-3 text-[12px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28"
          value={caseQuery}
          onChange={(e) => setCaseQuery(e.target.value)}
          placeholder={t('evaluation.filterByCaseId')}
        />
      </div>

      {loadError && <div className="text-[11px] text-destructive">{loadError}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-foreground/48">
          <Spinner /> {t('evaluation.loadingExperimentDetails')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          {caseQuery.trim() ? t('evaluation.noFailureMatch') : t('evaluation.noFailureModesRecorded')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.mode} className="mac-stock-tile rounded-[14px] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {t(failureModeLabel(row.mode))}
                  </span>
                  <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-destructive">
                    {row.count}
                  </span>
                </div>
                <span className="text-[10.5px] text-foreground/36">{t('evaluation.caseCount', { count: row.cases.length })}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {row.cases.map((entry) => (
                  <button
                    key={`${entry.experimentId}:${entry.caseId}`}
                    type="button"
                    onClick={() => onOpenCase({ experimentId: entry.experimentId, caseId: entry.caseId })}
                    className={`inline-flex items-center gap-1.5 rounded-[7px] px-2 py-1 font-mono text-[11px] transition-smooth hover:opacity-80 ${
                      entry.verdict && VERDICT_CLASS[entry.verdict]
                        ? VERDICT_CLASS[entry.verdict]
                        : 'bg-foreground/6 text-foreground/64'
                    }`}
                  >
                    {entry.caseId}
                    {entry.verdict === null && (
                      <span className="text-[9.5px] uppercase text-foreground/36">{t(RUN_STATUS_KEY[entry.runStatus] ?? entry.runStatus)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
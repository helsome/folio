import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { EvaluationCase, EvaluationResultRecord, EvaluationRun } from '@finagent/core';
import { useFinagentClient, type EvaluationExperimentDetail } from '../../client';
import { Button } from '../primitives/Button';
import { failureModeLabel, metricKindLabel, metricLabel, scorePercent } from './format';
import type { CaseRef } from './EvaluationCenter';

/**
 * Case detail (spec §64, §82): the recorded run for one benchmark case — tool
 * timeline, evaluator scores + reasons, failure modes, trace link and human
 * review. The case prompt/expectations live on the benchmark dataset and are
 * not exposed by the evaluation channel, so this view shows the recorded run
 * and its evaluation records.
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

/** Compact JSON summary of tool args (truncated for table display). */
function argsSummary(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || '{}';
}

function resultType(toolCall: EvaluationRun['toolCalls'][number]): string {
  if (toolCall.status === 'error') return 'error';
  if (toolCall.result === undefined || toolCall.result === null) return '—';
  return typeof toolCall.result === 'string' ? 'text' : typeof toolCall.result;
}

export const CaseDetail: React.FC<{
  caseRef: CaseRef;
  detail: EvaluationExperimentDetail | null;
  onLoadDetail: () => void;
  onBack: () => void;
}> = ({ caseRef, detail, onLoadDetail, onBack }) => {
  const client = useFinagentClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseDef, setCaseDef] = useState<EvaluationCase | null>(null);
  const [feedback, setFeedback] = useState<'good' | 'bad' | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) return;
    setLoading(true);
    setError(null);
    void (async () => {
      await onLoadDetail();
      setLoading(false);
    })();
  }, [detail, onLoadDetail]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.evaluation?.getCase(caseRef.caseId);
      if (!cancelled && result?.ok) setCaseDef(result.data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseRef.caseId, client]);

  const openTrace = (url: string): void => {
    void client.openExternal?.(url);
  };

  const submitFeedback = async (verdict: 'good' | 'bad'): Promise<void> => {
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackResult(null);
    const result = await client.evaluation?.submitFeedback({
      caseId: caseRef.caseId,
      verdict,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (result?.ok) {
      setFeedback(verdict);
      setFeedbackResult(`Feedback recorded (${verdict === 'good' ? '👍' : '👎'}).`);
      setNote('');
      setNoteOpen(false);
    } else {
      setFeedbackError(result?.error.message ?? 'Could not submit feedback.');
    }
  };

  if (loading || (detail === null && !error)) {
    return (
      <div className="flex h-full flex-col" data-testid="case-detail">
        <div className="border-b mac-section-divider px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
        <div className="flex items-center gap-2 p-4 text-[12px] text-foreground/48">
          <Spinner /> Loading case…
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col" data-testid="case-detail">
        <div className="border-b mac-section-divider px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
        <div className="p-4 text-[12px] text-foreground/48">
          {error ?? `Case ${caseRef.caseId} could not be loaded.`}
        </div>
      </div>
    );
  }

  const { experiment, runs, results } = detail;
  const matchingRuns = runs.filter((run) => run.caseId === caseRef.caseId);
  const run = matchingRuns[matchingRuns.length - 1];
  const result = results.find((entry) => entry.caseId === caseRef.caseId);
  if (!run && !result) {
    return (
      <div className="flex h-full flex-col" data-testid="case-detail">
        <div className="border-b mac-section-divider px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
        <div className="p-4 text-[12px] text-foreground/48">
          No run or evaluation record for case {caseRef.caseId} in “{experiment.name}”.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="case-detail">
      <header className="flex items-center justify-between border-b mac-section-divider px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Case <span className="font-mono text-accent">{caseRef.caseId}</span>
            </h2>
            <p className="mt-0.5 text-[11px] text-foreground/48">
              {experiment.name} · {experiment.datasetId} v{experiment.datasetVersion}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${VERDICT_STYLE[result.verdict]}`}>
              {result.verdict}
            </span>
          )}
          <span className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-foreground/64">
            {run?.status ?? 'no run'}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl space-y-4">
          <div className="mac-stock-tile rounded-[14px] p-5">
            <h3 className="text-[13px] font-semibold text-foreground">Case definition</h3>
            {caseDef ? (
              <div className="mt-2 space-y-3 text-[12.5px]">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-foreground/44">Prompt</p>
                  <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-foreground/78">
                    {caseDef.input.prompt}
                  </p>
                </div>
                {caseDef.input.workspaceContext && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-foreground/44">Workspace context</p>
                    <p className="mt-0.5 font-mono text-[11.5px] text-foreground/64">
                      {JSON.stringify(caseDef.input.workspaceContext)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-foreground/44">
                    Expected behavior
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10.5px] text-foreground/64">
                      {caseDef.category} · {caseDef.difficulty}
                    </span>
                    {caseDef.expected.requiredCapabilities?.map((cap) => (
                      <span key={`req-${cap}`} className="rounded-full border border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10 px-2 py-0.5 font-mono text-[10.5px] text-[var(--mac-green)]">
                        {cap}
                      </span>
                    ))}
                    {caseDef.expected.forbiddenCapabilities?.map((cap) => (
                      <span key={`forb-${cap}`} className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-[10.5px] text-destructive">
                        forbidden: {cap}
                      </span>
                    ))}
                    {caseDef.expected.maxToolCalls != null && (
                      <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10.5px] text-foreground/64">
                        ≤{caseDef.expected.maxToolCalls} calls
                      </span>
                    )}
                    {caseDef.expected.mustHaveEvidence && (
                      <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10.5px] text-foreground/64">
                        evidence required
                      </span>
                    )}
                    {caseDef.expected.requiredResearchDimensions?.map((dimension) => (
                      <span key={`dim-${dimension}`} className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10.5px] text-foreground/64">
                        {dimension}
                      </span>
                    ))}
                  </div>
                  {caseDef.expected.expectedAnswerHint && (
                    <p className="mt-1.5 text-[11.5px] text-foreground/54">
                      {caseDef.expected.expectedAnswerHint}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[11.5px] text-foreground/44">
                {run?.answer ? '' : 'Annotated prompt and expectations unavailable for this case definition.'}
              </p>
            )}
          </div>

          <div className="mac-stock-tile rounded-[14px] p-5">
            <h3 className="text-[13px] font-semibold text-foreground">Agent answer</h3>
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/78">
              {run?.answer?.trim() ? run.answer : 'No answer recorded for this run.'}
            </p>
            {run?.latencyMs != null && (
              <p className="mt-2 text-[11px] text-foreground/44">Latency {run.latencyMs}ms</p>
            )}
          </div>

          <div className="mac-stock-tile rounded-[14px] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-foreground">Tool timeline</h3>
              <span className="text-[11px] text-foreground/42">{run?.toolCalls.length ?? 0} call(s)</span>
            </div>
            {run && run.toolCalls.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[12px]" data-testid="tool-timeline">
                  <thead>
                    <tr className="border-b mac-section-divider">
                      <th className="py-2 pr-3 text-left font-medium text-foreground/54">#</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground/54">Tool</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground/54">Args</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground/54">Status</th>
                      <th className="px-3 py-2 text-right font-medium text-foreground/54">Latency</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground/54">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.toolCalls.map((toolCall, index) => (
                      <tr key={toolCall.id} className="border-b mac-section-divider last:border-0">
                        <td className="py-2 pr-3 tabular-nums text-foreground/44">{index + 1}</td>
                        <td className="px-3 py-2 font-mono font-medium text-foreground">{toolCall.toolName}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 font-mono text-foreground/54">
                          {argsSummary(toolCall.args)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={toolCall.status === 'success' ? 'text-[var(--mac-green)]' : 'text-destructive'}>
                            {toolCall.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground/64">
                          {toolCall.completedAt != null
                            ? `${Math.max(0, toolCall.completedAt - toolCall.startedAt)}ms`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-foreground/54">{resultType(toolCall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-foreground/44">No tool calls recorded.</p>
            )}
          </div>

          {result && (
            <div className="mac-stock-tile rounded-[14px] p-5">
              <h3 className="text-[13px] font-semibold text-foreground">Evaluator scores</h3>
              <div className="mt-3 space-y-2.5">
                {result.scores.length === 0 && (
                  <p className="text-[12px] text-foreground/44">No scores recorded.</p>
                )}
                {result.scores.map((score) => (
                  <div key={score.metric} className="rounded-[9px] border border-border bg-surface-muted px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[12.5px] font-medium text-foreground">{metricLabel(score.metric)}</span>
                        <span className="ml-2 text-[10.5px] text-foreground/40">{metricKindLabel(score.metric)}</span>
                      </div>
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                        {scorePercent(score.score)}
                      </span>
                    </div>
                    {score.reason && <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/64">{score.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mac-stock-tile rounded-[14px] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-foreground">Failure modes</h3>
              {run?.traceRef?.url && (
                <Button variant="outline" size="sm" onClick={() => openTrace(run.traceRef!.url!)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open LangSmith trace
                </Button>
              )}
            </div>
            {(result?.failureModes.length ?? 0) === 0 ? (
              <p className="mt-2 text-[12px] text-foreground/44">No failures recorded.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {result?.failureModes.map((mode) => (
                  <span
                    key={mode}
                    className="inline-flex rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground/78"
                  >
                    {failureModeLabel(mode)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mac-stock-tile rounded-[14px] p-5">
            <h3 className="text-[13px] font-semibold text-foreground">Human review</h3>
            <p className="mt-1 text-[11.5px] text-foreground/48">
              Mark the run good/bad — this feeds the human feedback log (spec §82).
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant={feedback === 'good' ? 'default' : 'secondary'}
                size="sm"
                disabled={submitting}
                onClick={() => void submitFeedback('good')}
              >
                <ThumbsUp className="h-3.5 w-3.5" /> Good
              </Button>
              <Button
                variant={feedback === 'bad' ? 'destructive' : 'secondary'}
                size="sm"
                disabled={submitting}
                onClick={() => void submitFeedback('bad')}
              >
                <ThumbsDown className="h-3.5 w-3.5" /> Bad
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNoteOpen((open) => !open)}>
                {noteOpen ? 'Hide note' : 'Add note'}
              </Button>
            </div>
            {noteOpen && (
              <div className="mt-3 flex items-start gap-2">
                <input
                  className="mac-input h-9 flex-1 rounded-[10px] px-3 text-[12px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note attached to the next 👍/👎"
                />
              </div>
            )}
            {feedbackResult && <p className="mt-3 text-[11px] text-[var(--mac-green)]">{feedbackResult}</p>}
            {feedbackError && <p className="mt-3 text-[11px] text-destructive">{feedbackError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
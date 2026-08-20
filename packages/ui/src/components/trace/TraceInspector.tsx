import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Circle, ExternalLink, LoaderCircle, X } from 'lucide-react';
import type { FolioTrace, TraceContextField, TraceStep } from '@finagent/core';
import {
  semanticCompletenessLabelKey,
  semanticContextSourceLabelKey,
  semanticElementSourceLabelKey,
  semanticStatusLabelKey,
  semanticToolLabelKey,
} from '../../lib/agentPresentation';
import { Dialog } from '../primitives/Dialog';

type TraceTab = 'overview' | 'timeline' | 'context' | 'details';

const TAB_KEYS: Array<{ id: TraceTab; labelKey: string }> = [
  { id: 'overview', labelKey: 'trace.tabs.overview' },
  { id: 'timeline', labelKey: 'trace.tabs.timeline' },
  { id: 'context', labelKey: 'trace.tabs.context' },
  { id: 'details', labelKey: 'trace.tabs.details' },
];

const SOURCE_BADGE: Record<string, string> = {
  event: 'bg-accent/10 text-accent',
  message: 'bg-foreground/6 text-foreground/60',
  'trace-event': 'bg-info/10 text-info',
  run: 'bg-foreground/6 text-foreground/60',
  evaluation: 'bg-warning/10 text-warning',
  langsmith: 'bg-positive/10 text-positive',
};

const StepIcon: React.FC<{ step: TraceStep }> = ({ step }) => {
  if (step.kind === 'tool') {
    if (step.status === 'error') return <X className="h-3.5 w-3.5 shrink-0 text-negative" />;
    if (step.status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />;
    return <Check className="h-3.5 w-3.5 shrink-0 text-positive" />;
  }
  if (step.kind === 'user') return <Circle className="h-3 w-3 shrink-0 text-accent" />;
  if (step.kind === 'runtime') return <LoaderCircle className="h-3 w-3 shrink-0 text-foreground/38" />;
  return <Circle className="h-3 w-3 shrink-0 text-foreground/30" />;
};

const ContextSourceBadge: React.FC<{ source: TraceContextField['source'] }> = ({ source }) => {
  const { t } = useTranslation();
  const tone =
    source === 'evaluation-input'
      ? 'bg-info/12 text-info'
      : source === 'live'
        ? 'bg-positive/12 text-positive'
        : source === 'not-recorded'
          ? 'bg-foreground/6 text-foreground/42'
          : 'bg-foreground/8 text-foreground/64';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {t(semanticContextSourceLabelKey(source))}
    </span>
  );
};

/**
 * Trace Inspector — progressive-disclosure debugging surface (V9.1 §8).
 * Rendered inside a dialog; opened only from the AgentPanel run footer or a
 * failing Evaluation case. Not a primary navigation feature.
 */
export const TraceInspector: React.FC<{
  trace: FolioTrace | null;
  onClose: () => void;
  onOpenLangSmith?: (url: string) => void;
}> = ({ trace, onClose, onOpenLangSmith }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TraceTab>('overview');

  if (!trace) {
    return (
      <Dialog open onClose={onClose} title={t('trace.overview.title')} className="max-w-2xl">
        <div className="flex items-center gap-2 py-6 text-[12.5px] text-foreground/48">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          {t('evaluation.loadingCase')}
        </div>
      </Dialog>
    );
  }

  const hasTraceUrl = Boolean(trace.traceRef?.url);
  const durationSec = trace.latencyMs != null ? Math.max(0, Math.round(trace.latencyMs / 100) / 10) : undefined;

  return (
    <Dialog open onClose={onClose} title={t('trace.overview.title')} className="max-w-2xl">
      <div className="flex flex-col gap-3" data-testid="trace-inspector">
        {/* Tab bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1">
            {TAB_KEYS.map((tabDef) => (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => setTab(tabDef.id)}
                aria-pressed={tab === tabDef.id}
                className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-smooth ${
                  tab === tabDef.id ? 'bg-accent/10 text-foreground' : 'text-foreground/52 hover:bg-foreground/6 hover:text-foreground'
                }`}
              >
                {t(tabDef.labelKey)}
              </button>
            ))}
          </div>
          {hasTraceUrl && onOpenLangSmith && (
            <button
              type="button"
              onClick={() => onOpenLangSmith(trace.traceRef!.url!)}
              data-testid="trace-open-langsmith"
              className="flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-foreground/70 transition-smooth hover:border-border-strong hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              {t('trace.actions.openLangSmith')}
            </button>
          )}
        </div>

        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className="font-medium text-foreground">
            {trace.status === 'running'
              ? t('agent.tool.statusRunning')
              : t(`trace.status.${trace.status === 'failed' ? 'error' : 'success'}`)}
          </span>
          <span className="text-foreground/30">·</span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 font-medium text-foreground/60">
            {t(semanticCompletenessLabelKey(trace.completeness))}
          </span>
          {durationSec !== undefined && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="tnum text-foreground/60">{t('trace.overview.latency', { seconds: durationSec })}</span>
            </>
          )}
          <span className="text-foreground/30">·</span>
          <span className="text-foreground/60">{t('trace.overview.tools', { count: trace.tools.length })}</span>
          <span className="text-foreground/30">·</span>
          <span className="text-foreground/60">{t('trace.overview.steps', { count: trace.steps.length })}</span>
          {trace.sources.map((source) => (
            <span key={source} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_BADGE[source] ?? 'bg-foreground/6 text-foreground/50'}`}>
              {t(semanticElementSourceLabelKey(source))}
            </span>
          ))}
        </div>

        {/* Completeness hint */}
        <p className="text-[11.5px] text-foreground/52">{t(`trace.completeness.${trace.completeness}Hint`)}</p>

        {tab === 'overview' && <OverviewTab trace={trace} />}
        {tab === 'timeline' && <TimelineTab trace={trace} />}
        {tab === 'context' && <ContextTab trace={trace} />}
        {tab === 'details' && <DetailsTab trace={trace} />}
      </div>
    </Dialog>
  );
};

const OverviewTab: React.FC<{ trace: FolioTrace }> = ({ trace }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="trace-overview">
      {trace.evaluation && (
        <div className="rounded-[10px] border border-warning/30 bg-warning/6 p-3" data-testid="trace-evaluation-findings">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-warning">
            {t('trace.evaluation.title')}
          </div>
          <p className="mt-1 text-[11px] text-foreground/50">{t('trace.evaluation.note')}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <span className="text-foreground/62">
              {t('trace.evaluation.verdict')}: <span className="font-semibold capitalize">{trace.evaluation.verdict}</span>
            </span>
            {trace.evaluation.failureMode && (
              <span className="text-foreground/62">
                {t('trace.evaluation.failureMode')}: <span className="font-mono text-negative">{trace.evaluation.failureMode}</span>
              </span>
            )}
          </div>
          {trace.evaluation.expected && trace.evaluation.expected.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="text-foreground/52">{t('trace.evaluation.expected')}:</span>
              {trace.evaluation.expected.map((item) => (
                <span key={`exp-${item}`} className="rounded-[5px] bg-foreground/6 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/70">{item}</span>
              ))}
            </div>
          )}
          {trace.evaluation.actual && trace.evaluation.actual.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="text-foreground/52">{t('trace.evaluation.actual')}:</span>
              {trace.evaluation.actual.map((item) => (
                <span key={`act-${item}`} className="rounded-[5px] bg-foreground/6 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/70">{item}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">{t('trace.overview.input')}</div>
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/80">{trace.input || t('trace.notRecorded')}</p>
      </div>
      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">{t('trace.overview.answer')}</div>
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/80">
          {trace.answer?.trim() ? trace.answer : t('trace.overview.noAnswer')}
        </p>
      </div>
      {trace.error && (
        <div className="rounded-[10px] border border-destructive/26 bg-destructive/6 p-3 text-[12px] text-destructive">
          {trace.error}
        </div>
      )}
    </div>
  );
};

const TimelineStep: React.FC<{ step: TraceStep }> = ({ step }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label =
    step.kind === 'tool' ? t(semanticToolLabelKey(step.tool?.toolName ?? step.label)) : step.label;
  const isTool = step.kind === 'tool';
  const body = (
    <>
      <StepIcon step={step} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">{label}</span>
      {isTool && step.status === 'running' && (
        <span className="shrink-0 text-[10.5px] text-accent">{t('agent.tool.statusRunning')}</span>
      )}
      {isTool && step.tool?.durationMs != null && (
        <span className="tnum shrink-0 text-[10.5px] text-foreground/40">{step.tool.durationMs}ms</span>
      )}
      {isTool && (
        <ChevronDown className={`h-3 w-3 shrink-0 text-foreground/34 transition-transform ${open ? 'rotate-180' : ''}`} />
      )}
    </>
  );
  return (
    <div className="rounded-[8px] border border-border/70 bg-surface-muted/50 px-3 py-2">
      {isTool ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2">{body}</div>
      )}
      {isTool && open && step.tool && (
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px] text-foreground/54">
          {step.tool.args && Object.keys(step.tool.args).length > 0 && (
            <div className="font-mono">{JSON.stringify(step.tool.args)}</div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {step.tool.resultType && <span>{t('trace.overview.answer')}: {step.tool.resultType}</span>}
            {step.tool.error && <span className="text-negative">{step.tool.error}</span>}
            <span className="text-foreground/34">{t(semanticElementSourceLabelKey(step.source))}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const TimelineTab: React.FC<{ trace: FolioTrace }> = ({ trace }) => {
  const { t } = useTranslation();
  if (trace.steps.length === 0) {
    return <p className="text-[12px] text-foreground/46">{t('trace.notRecorded')}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="trace-timeline">
      {trace.steps.map((step) => (
        <TimelineStep key={step.id} step={step} />
      ))}
    </div>
  );
};

const ContextTab: React.FC<{ trace: FolioTrace }> = ({ trace }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="trace-context">
      <p className="text-[11.5px] leading-relaxed text-foreground/52">{t('trace.context.explanation')}</p>
      <div className="overflow-hidden rounded-[10px] border mac-list-row">
        {trace.context.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-foreground/46">{t('trace.notRecorded')}</div>
        ) : (
          trace.context.map((field) => (
            <div key={field.key} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
              <span className="text-[12px] font-medium text-foreground/70">{field.key}</span>
              <span className={field.value ? 'text-[12px] text-foreground/80' : 'text-[12px] italic text-foreground/38'}>
                {field.value || t('trace.notRecorded')}
              </span>
              <ContextSourceBadge source={field.source} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const DetailsTab: React.FC<{ trace: FolioTrace }> = ({ trace }) => {
  const { t } = useTranslation();
  const budget = trace.budget;
  return (
    <div className="flex flex-col gap-3" data-testid="trace-details">
      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">{t('trace.details.sources')}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {trace.sources.length === 0 && <span className="text-[12px] text-foreground/46">{t('trace.notRecorded')}</span>}
          {trace.sources.map((source) => (
            <span key={source} className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${SOURCE_BADGE[source] ?? 'bg-foreground/6 text-foreground/50'}`}>
              {t(semanticElementSourceLabelKey(source))}
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">{t('trace.details.traceRef')}</div>
        {trace.traceRef ? (
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-foreground/60">
            <div>backend: {trace.traceRef.backend}</div>
            {trace.traceRef.traceId && <div>traceId: {trace.traceRef.traceId}</div>}
            {trace.traceRef.threadId && <div>threadId: {trace.traceRef.threadId}</div>}
            {trace.traceRef.url && <div className="truncate">url: {trace.traceRef.url}</div>}
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-foreground/46">{t('trace.notRecorded')}</p>
        )}
      </div>
      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">{t('trace.details.budget')}</div>
        {budget ? (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11.5px]">
            {budget.inputTokens !== undefined && <span className="text-foreground/62">{t('trace.details.budgetInput')}: <span className="tnum">{budget.inputTokens}</span></span>}
            {budget.outputTokens !== undefined && <span className="text-foreground/62">{t('trace.details.budgetOutput')}: <span className="tnum">{budget.outputTokens}</span></span>}
            {budget.totalTokens !== undefined && <span className="text-foreground/62">{t('trace.details.budgetTotal')}: <span className="tnum">{budget.totalTokens}</span></span>}
            {budget.cacheRead !== undefined && <span className="text-foreground/62">{t('trace.details.budgetCacheRead')}: <span className="tnum">{budget.cacheRead}</span></span>}
            {budget.cacheWrite !== undefined && <span className="text-foreground/62">{t('trace.details.budgetCacheWrite')}: <span className="tnum">{budget.cacheWrite}</span></span>}
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-foreground/46">{t('trace.details.budgetNotRecorded')}</p>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Check, Search } from 'lucide-react';
import type { ResearchRunSummary, ResearchReport, StrategyId } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { pendingResearchStrategyAtom, researchOriginAtom } from '../../atoms/discoverAtoms';
import {
  researchRunsAtom,
  researchReportAtom,
  selectedReportIdAtom,
  researchLoadingAtom,
  startResearch,
  cancelResearch,
  loadResearchRuns,
  loadResearchRun,
  loadSymbolReports,
  loadResearchReport,
  TERMINAL_RUN_STATUSES,
} from '../../atoms/researchAtoms';
import { researchSelectionAtom } from '../../atoms/researchSelectionAtoms';
import { saveThesisFromReport } from '../../client/thesis';
import { ResearchReportView } from './ResearchReportView';
import { ResearchMarketWorkspace } from './ResearchMarketWorkspace';
import { DEFAULT_STRATEGY_ID, StrategyPicker } from './StrategyPicker';
import { NextAction } from '../primitives/NextAction';
import { semanticCapabilityLabelKey } from '../../lib/agentPresentation';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { ContentReveal } from '../motion/ContentReveal';
import { useFinagentClient } from '../../client';

const POLL_MS = 900;
const SYMBOL_REGEX = /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/;

/** localStorage key for the last strategy chosen for a symbol (V9 §20). */
function lastStrategyKey(symbol: string): string {
  return `lastStrategy.${symbol}`;
}

/** Deep Research entry: run history for the focused symbol + start/cancel + report. */
export const ResearchPanel: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const store = useStore();
  const symbol = useAtomValue(activeSymbolAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [runs, setRuns] = useAtom(researchRunsAtom);
  const [reportHistory, setReportHistory] = useState<{ symbol: string; reports: ResearchReport[] } | null>(null);
  const [report, setReport] = useAtom(researchReportAtom);
  const [selectedReportId, setSelectedReportId] = useAtom(selectedReportIdAtom);
  const [loading, setLoading] = useAtom(researchLoadingAtom);
  const [error, setError] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<StrategyId>(DEFAULT_STRATEGY_ID);
  const [pendingStrategy, setPendingStrategy] = useAtom(pendingResearchStrategyAtom);
  const [researchOrigin, setResearchOrigin] = useAtom(researchOriginAtom);
  const [recommendedStrategy, setRecommendedStrategy] = useState<StrategyId | null>(null);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [thesisSaved, setThesisSaved] = useState(false);
  const pendingActionRef = useRef(0);
  const pendingSymbolRef = useRef(symbol);
  const contextRef = useRef({ symbol, selectedReportId });
  if (contextRef.current.symbol !== symbol || contextRef.current.selectedReportId !== selectedReportId) {
    contextRef.current = { symbol, selectedReportId };
  }
  useEffect(() => {
    setLoading(false);
    return () => {
      pendingActionRef.current++;
      contextRef.current = { symbol: null, selectedReportId: null };
    };
  }, [setLoading]);

  // Discover → Research: a candidate card carries a recommended strategy.
  useEffect(() => {
    if (pendingStrategy) {
      setStrategyId(pendingStrategy);
      setRecommendedStrategy(pendingStrategy);
      setPendingStrategy(null);
      return;
    }
    // No recommendation: reuse the last strategy the user ran for this
    // symbol, so repeated research doesn't force a re-selection (V9 §20).
    if (symbol) {
      const last = readPersisted<StrategyId | null>(lastStrategyKey(symbol), null);
      if (last) setStrategyId(last);
    }
  }, [pendingStrategy, setPendingStrategy, symbol]);

  useEffect(() => {
    let alive = true;
    void loadResearchRuns().then((loaded) => {
      if (!alive) return;
      setRuns(loaded);
      const validRuns = loaded.filter((run) => SYMBOL_REGEX.test(run.symbol));
      const recent = validRuns.find((run) => run.status === 'interrupted' || !(run.status in TERMINAL_RUN_STATUSES)) ?? validRuns[0];
      const saved = store.get(researchSelectionAtom);
      const restoredSymbol = saved && SYMBOL_REGEX.test(saved.symbol) && typeof saved.reportId === 'string'
        ? saved.symbol : null;
      setActiveSymbol((current) => current ?? restoredSymbol ?? recent?.symbol ?? null);
    });
    return () => { alive = false; };
  }, [setRuns, setActiveSymbol, store]);

  useEffect(() => {
    setError(null);
    if (pendingSymbolRef.current !== symbol) {
      pendingActionRef.current++;
      pendingSymbolRef.current = symbol;
      setLoading(false);
    }
  }, [symbol, setLoading]);

  useEffect(() => {
    let alive = true;
    if (symbol) void loadSymbolReports(symbol).then((loaded) => {
      if (alive) setReportHistory({ symbol, reports: loaded.filter((item) => item.symbol === symbol)
        .sort((a, b) => b.generatedAt - a.generatedAt) });
    });
    return () => { alive = false; };
  }, [symbol, runs]);

  const reports = reportHistory?.symbol === symbol ? reportHistory.reports : [];
  const activeRun = runs.find(
    (run) => run.symbol === symbol && !(run.status in TERMINAL_RUN_STATUSES)
  );
  const latestReportId = reports[0]?.id;
  useEffect(() => {
    if (symbol && !selectedReportId && !activeRun && !loading && latestReportId) setSelectedReportId(latestReportId);
  }, [symbol, selectedReportId, activeRun?.id, loading, latestReportId, setSelectedReportId]);

  useEffect(() => {
    let alive = true;
    setThesisSaved(false);
    if (!symbol || !selectedReportId) {
      setReport(null);
    } else {
      void loadResearchReport(selectedReportId).then((loaded) => {
        if (!alive || store.get(activeSymbolAtom) !== symbol || store.get(selectedReportIdAtom) !== selectedReportId) return;
        if (loaded?.symbol === symbol && loaded.id === selectedReportId) setReport(loaded);
        else { setReport(null); setError(t('research.reportUnavailable')); }
      });
    }
    return () => { alive = false; };
  }, [symbol, selectedReportId, setReport, store, t]);

  // Poll the newest active run for this symbol while it is non-terminal.
  useEffect(() => {
    if (!activeRun) return;
    let alive = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      const updated = await loadResearchRun(activeRun.id);
      polling = false;
      if (!alive || !updated || updated.symbol !== symbol || store.get(activeSymbolAtom) !== symbol) return;
      setRuns((current) => {
        const next = [updated, ...current.filter((run) => run.id !== updated.id)];
        return next;
      });
      if (updated.status in TERMINAL_RUN_STATUSES && updated.reportId) {
        setSelectedReportId((current) => current ?? updated.reportId!);
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeRun?.id, symbol, setRuns, setSelectedReportId, store]);

  const handleStart = async (targetSymbol = symbol) => {
    if (!targetSymbol || (targetSymbol === symbol && (loading || activeRun))) return;
    const context = contextRef.current.symbol === targetSymbol ? contextRef.current : null;
    const selectedAtStart = store.get(selectedReportIdAtom);
    const request = ++pendingActionRef.current;
    pendingSymbolRef.current = targetSymbol;
    const isCurrent = () => pendingActionRef.current === request && store.get(activeSymbolAtom) === targetSymbol &&
      (context ? contextRef.current === context : store.get(selectedReportIdAtom) === selectedAtStart);
    setLoading(true);
    setError(null);
    try {
      const started = await startResearch({ symbol: targetSymbol, strategyId });
      if (started) {
        setRuns((current) => [started, ...current.filter((run) => run.id !== started.id)]);
        if (isCurrent()) {
          setSelectedReportId(started.reportId ?? null);
        }
        // Remember this strategy for the symbol so the next run defaults to it.
        writePersisted(lastStrategyKey(targetSymbol), strategyId);
      } else {
        if (isCurrent()) setError(t('research.notAvailable'));
      }
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (pendingActionRef.current === request) setLoading(false);
    }
  };

  const handleStrategyChange = (next: StrategyId): void => {
    setStrategyId(next);
    if (symbol) writePersisted(lastStrategyKey(symbol), next);
  };

  /** V9: start research directly from the no-symbol entry point. */
  const handleSymbolEntrySubmit = () => {
    const value = symbolInput.trim().toUpperCase();
    if (!SYMBOL_REGEX.test(value)) {
      setSymbolError(t('research.symbolEntry.invalid'));
      return;
    }
    setSymbolError(null);
    setActiveSymbol(value);
    setSymbolInput('');
    void handleStart(value);
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    await cancelResearch(activeRun.id);
  };

  /** V9: research complete → one-click save as investment thesis. */
  const handleSaveThesis = async () => {
    if (!symbol || !report) return;
    const context = contextRef.current;
    const created = await saveThesisFromReport(symbol, report.id);
    if (contextRef.current !== context || store.get(selectedReportIdAtom) !== report.id) return;
    if (created) {
      setThesisSaved(true);
    } else {
      setError(t('research.notAvailable'));
    }
  };

  /** V9: return to the section the user came from (Discover results / Portfolio). */
  const handleBackToOrigin = (): void => {
    const origin = researchOrigin;
    if (!origin) return;
    setNavSection(origin.from === 'discover' ? 'discover' : 'portfolio');
    setResearchOrigin(null);
  };

  const recoverableRuns = runs.filter((run) => (!symbol || run.symbol === symbol) &&
    (run.status === 'interrupted' || (run.status === 'failed' && run.error)));

  const handleRecovery = async (runId: string, action: 'resume' | 'restart' | 'discard') => {
    const context = contextRef.current;
    const request = ++pendingActionRef.current;
    pendingSymbolRef.current = symbol;
    setLoading(true);
    setError(null);
    try {
      const method = client.research?.[action];
      if (!method) throw new Error(t('research.notAvailable'));
      const result = await method({ runId });
      if (pendingActionRef.current !== request) return;
      if (!result.ok) throw new Error(result.error.message);
      const loaded = await loadResearchRuns();
      if (pendingActionRef.current !== request) return;
      setRuns(loaded);
      if (contextRef.current === context && action !== 'discard' && result.data) {
        setActiveSymbol((result.data as ResearchRunSummary).symbol);
      }
    } catch (caught) {
      if (contextRef.current === context) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (pendingActionRef.current === request) setLoading(false);
    }
  };

  return (
    <div className="folio-pilot-shell flex h-full flex-col" data-testid="research-panel">
      <div className="folio-research-topbar">
        <span className="folio-research-topbar-title">{t('research.workspace.title')}</span>
        <label className="folio-research-command-search">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={symbolInput}
            onChange={(event) => {
              setSymbolInput(event.target.value.toUpperCase());
              setSymbolError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSymbolEntrySubmit();
            }}
            placeholder={t('research.workspace.searchPlaceholder')}
            aria-label={t('research.workspace.searchPlaceholder')}
          />
          <span className="folio-research-command-hint">⌘ K</span>
        </label>
        <span className="folio-research-topbar-market">USD <span aria-hidden="true">⌄</span></span>
      </div>
      <div className="folio-pilot-research-header">
        <div>
          <h2 className="folio-pilot-research-title">{t('research.deepResearch')}</h2>
          <p className="folio-pilot-subtitle">
            {symbol
              ? t('research.subtitleFor', { symbol })
              : t('research.subtitleEmpty')}
          </p>
        </div>
        {symbol && (
          <div className="flex items-center gap-2">
            {activeRun && (
              <button
                onClick={() => void handleCancel()}
                className="mac-secondary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold"
              >
                {t('research.stop')}
              </button>
            )}
            <button
              onClick={() => void handleStart()}
              disabled={!symbol || loading || Boolean(activeRun)}
              className="mac-primary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-45"
            >
              {loading ? t('research.starting') : t('research.deepResearch')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-[9px] border border-destructive/24 bg-destructive/6 px-3 py-2.5">
          <p className="text-[12.5px] text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded-[7px] border border-border px-2 py-1 text-[11.5px] font-medium text-foreground/68 hover:bg-foreground/6"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {researchOrigin && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={handleBackToOrigin}
            data-testid="research-back-origin"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-border-strong hover:text-foreground"
          >
            ← {t('research.backToOrigin', { label: researchOrigin.label })}
          </button>
        </div>
      )}

      <div className="folio-pilot-research-content">
        {recoverableRuns.map((run) => (
          <div key={run.id} data-testid="research-recovery" className="mb-3 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">{t('research.recovery.title', { symbol: run.symbol })}</p>
            <p className="mt-1 text-xs text-text-muted">{t('research.recovery.saved', { count: run.completedCapabilities.length })}</p>
            {run.error && <p className="mt-1 text-xs text-destructive">{run.error}</p>}
            <div className="mt-3 flex gap-2">
              {(['resume', 'restart', 'discard'] as const).map((action) => (
                <button key={action} type="button" disabled={loading || Boolean(activeRun) || (action === 'resume' && !run.recoverable)}
                  onClick={() => void handleRecovery(run.id, action)}
                  className="mac-secondary-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-45">
                  {t('research.recovery.' + action)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!symbol && <SymbolEntry error={symbolError} value={symbolInput} onChange={setSymbolInput} onSubmit={handleSymbolEntrySubmit} />}

        {symbol && (
          <ReportHistory reports={reports} selectedReportId={selectedReportId} onSelect={(reportId) => {
            setError(null);
            setSelectedReportId(reportId);
          }} />
        )}

        {symbol && (
          <ResearchMarketWorkspace
            key={symbol}
            symbol={symbol}
            report={report && report.symbol === symbol ? report : null}
            activeRun={activeRun?.status ?? null}
            loading={loading}
            onStart={() => void handleStart()}
          />
        )}

        {symbol && !activeRun && (!report || report.symbol !== symbol) && (
          <div className="folio-research-strategy-section">
            <div className="folio-research-section-kicker">{t('research.researchStrategy')}</div>
            <StrategyPicker value={strategyId} onChange={handleStrategyChange} recommendedId={recommendedStrategy} />
          </div>
        )}

        {symbol && !activeRun && report && report.symbol === symbol && (
          <details className="folio-pilot-strategy-context">
            <summary>{t('research.researchStrategy')}</summary>
            <div className="pt-3">
              <StrategyPicker value={strategyId} onChange={handleStrategyChange} recommendedId={recommendedStrategy} />
            </div>
          </details>
        )}

        {activeRun && (
          <RunProgressCard key={activeRun.id} run={activeRun} />
        )}

        {report && symbol && report.symbol === symbol && (
          <ContentReveal testId="research-report-reveal">
            <ResearchReportView
              key={report.id}
              report={report}
              nextAction={
                thesisSaved ? (
                  <div data-testid="thesis-saved-banner" className="folio-pilot-next-action text-[12.5px] font-medium text-positive">
                    {t('research.next.thesisSaved')}
                  </div>
                ) : (
                  <NextAction
                    testId="research-next-action"
                    primaryLabel={t('research.next.saveThesis')}
                    onPrimary={() => void handleSaveThesis()}
                    secondaryLabel={t('research.next.viewThesis')}
                    onSecondary={() => setNavSection('thesis')}
                    hint={t('research.next.saveThesisHint')}
                  />
                )
              }
            />
          </ContentReveal>
        )}

      </div>
    </div>
  );
};

/** V9: first-time research start — "What are you researching?" with a primary action. */
const SymbolEntry: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
}> = ({ value, onChange, onSubmit, error }) => {
  const { t } = useTranslation();
  return (
    <div data-testid="research-symbol-entry" className="mx-auto mt-6 w-full max-w-md rounded-[12px] border border-border bg-surface p-5">
      <h3 className="text-[15px] font-semibold text-foreground">{t('research.symbolEntry.title')}</h3>
      <p className="mt-0.5 text-[12px] text-foreground/54">{t('research.symbolEntry.hint')}</p>
      <div className="mt-3 flex gap-2">
        <input
          data-testid="research-symbol-input"
          value={value}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
          }}
          placeholder={t('research.symbolEntry.placeholder')}
          aria-label={t('research.symbolEntry.placeholder')}
          className="h-9 w-full min-w-0 flex-1 rounded-[9px] border border-input bg-background px-3 text-[13px] text-foreground placeholder:text-foreground/38 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={onSubmit}
          data-testid="research-symbol-submit"
          className="mac-primary-button flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] px-3.5 text-[13px] font-semibold transition-smooth active:scale-[0.985]"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('research.symbolEntry.start')}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
    </div>
  );
};

const RunProgressCard: React.FC<{ run: ResearchRunSummary }> = ({ run }) => {
  const { t } = useTranslation();
  const planned = run.plannedCapabilities.length;
  const done = run.completedCapabilities.length;
  const failed = run.failedCapabilities.length;
  const humanized = (id: string): string => {
    return t(semanticCapabilityLabelKey(id));
  };
  return (
    <div className="folio-pilot-progress mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-foreground">
          {run.status === 'fetching' ? t('research.fetching') : t('research.synthesizing')}
        </span>
        <span className="tnum text-[11px] text-text-muted">
          {t('research.capabilitiesCount', { done, planned })}
          {failed > 0 ? ` ${t('research.failedCount', { failed })}` : ''}
        </span>
      </div>
      <div className="folio-pilot-progress-bar mt-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${planned === 0 ? 100 : Math.round((done / planned) * 100)}%` }}
        />
      </div>
      <SemanticStageList run={run} />
      <div className="hidden" aria-hidden="true">
        {run.plannedCapabilities.map((capabilityId) => {
          const doneCap = run.completedCapabilities.includes(capabilityId);
          const failedCap = run.failedCapabilities.includes(capabilityId);
          return (
            <span
              key={capabilityId}
              className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-medium ${
                doneCap
                  ? 'bg-positive/12 text-positive'
                  : failedCap
                    ? 'bg-negative/12 text-negative'
                    : 'bg-foreground/8 text-text-muted'
              }`}
            >
              {doneCap && <Check className="h-2.5 w-2.5" strokeWidth={2.2} />}
              {humanized(capabilityId)}
            </span>
          );
        })}
      </div>
    </div>
  );
};

type ResearchStageKey = 'market' | 'financials' | 'valuation' | 'events' | 'synthesis';
type ResearchStageState = 'pending' | 'active' | 'done' | 'failed';

const RESEARCH_STAGES: ReadonlyArray<{ key: ResearchStageKey }> = [
  { key: 'market' },
  { key: 'financials' },
  { key: 'valuation' },
  { key: 'events' },
  { key: 'synthesis' },
];

function stageForCapability(capabilityId: string): ResearchStageKey {
  if (capabilityId.startsWith('market.')) return 'market';
  if (capabilityId === 'company.valuation') return 'valuation';
  if (capabilityId.startsWith('company.')) return 'financials';
  if (capabilityId.startsWith('research.')) return 'events';
  return 'financials';
}

const SemanticStageList: React.FC<{ run: ResearchRunSummary }> = ({ run }) => {
  const { t } = useTranslation();
  const openStage = RESEARCH_STAGES.find((stage) => {
    const capabilities = run.plannedCapabilities.filter(
      (capabilityId) => stageForCapability(capabilityId) === stage.key
    );
    return capabilities.some(
      (capabilityId) =>
        !run.completedCapabilities.includes(capabilityId) &&
        !run.failedCapabilities.includes(capabilityId)
    );
  })?.key;

  const stateFor = (stage: ResearchStageKey): ResearchStageState => {
    if (stage === 'synthesis' && run.status === 'synthesizing') return 'active';
    const capabilities = run.plannedCapabilities.filter(
      (capabilityId) => stageForCapability(capabilityId) === stage
    );
    if (capabilities.length > 0 && capabilities.every((capabilityId) => run.completedCapabilities.includes(capabilityId))) {
      return 'done';
    }
    if (capabilities.some((capabilityId) => run.failedCapabilities.includes(capabilityId))) {
      return 'failed';
    }
    return openStage === stage ? 'active' : 'pending';
  };

  return (
    <div className="folio-pilot-stage-list" aria-label={t('research.stages.label')}>
      {RESEARCH_STAGES.map((stage) => {
        const state = stateFor(stage.key);
        const marker = state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'active' ? '•' : '·';
        return (
          <div key={stage.key} className={'folio-pilot-stage folio-pilot-stage--' + state}>
            <span className="folio-pilot-stage-marker" aria-hidden="true">{marker}</span>
            <span>{t('research.stages.' + stage.key)}</span>
          </div>
        );
      })}
    </div>
  );
};

const ReportHistory: React.FC<{
  reports: ResearchReport[];
  selectedReportId: string | null;
  onSelect: (reportId: string) => void;
}> = ({ reports, selectedReportId, onSelect }) => {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1.5" data-testid="research-history" aria-label={t('research.history')}>
      <h3 className="text-[12.5px] font-semibold text-foreground">{t('research.history')}</h3>
      {reports.length === 0 && <EmptyState />}
      {reports.map((item) => (
        <button
          key={item.id}
          data-report-id={item.id}
          aria-pressed={selectedReportId === item.id}
          onClick={() => onSelect(item.id)}
          className="mac-list-row flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left"
        >
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            {selectedReportId === item.id && <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />}
            {item.symbol}
          </span>
          <span className="tnum text-[11px] text-text-muted">
            {t(`research.runStatus.${item.runStatus}`)} · {new Date(item.generatedAt).toLocaleString()}
          </span>
        </button>
      ))}
    </section>
  );
};

const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="py-10 text-center text-[12px] text-text-muted">
      {t('research.empty')}
    </div>
  );
};

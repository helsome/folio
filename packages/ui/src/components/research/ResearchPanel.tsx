import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Check, Search } from 'lucide-react';
import type { ResearchRunSummary, ResearchReport, StrategyId } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { pendingResearchStrategyAtom, researchOriginAtom } from '../../atoms/discoverAtoms';
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
import { saveThesisFromReport } from '../../client/thesis';
import { ResearchReportView } from './ResearchReportView';
import { ResearchMarketWorkspace } from './ResearchMarketWorkspace';
import { DEFAULT_STRATEGY_ID, StrategyPicker } from './StrategyPicker';
import { NextAction } from '../primitives/NextAction';
import { semanticCapabilityLabelKey } from '../../lib/agentPresentation';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';

const POLL_MS = 900;
const SYMBOL_REGEX = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

/** localStorage key for the last strategy chosen for a symbol (V9 §20). */
function lastStrategyKey(symbol: string): string {
  return `lastStrategy.${symbol}`;
}

/** Deep Research entry: run history for the focused symbol + start/cancel + report. */
export const ResearchPanel: React.FC = () => {
  const { t } = useTranslation();
  const symbol = useAtomValue(activeSymbolAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [runs, setRuns] = useAtom(researchRunsAtom);
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [report, setReport] = useAtom(researchReportAtom);
  const [loading, setLoading] = useAtom(researchLoadingAtom);
  const [error, setError] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<StrategyId>(DEFAULT_STRATEGY_ID);
  const [pendingStrategy, setPendingStrategy] = useAtom(pendingResearchStrategyAtom);
  const [researchOrigin, setResearchOrigin] = useAtom(researchOriginAtom);
  const [recommendedStrategy, setRecommendedStrategy] = useState<StrategyId | null>(null);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [thesisSaved, setThesisSaved] = useState(false);

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
    void loadResearchRuns().then(setRuns);
  }, [setRuns]);

  useEffect(() => {
    if (!symbol) {
      setReports([]);
      setReport(null);
      setThesisSaved(false);
      return;
    }
    setThesisSaved(false);
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

  const handleStart = async (targetSymbol = symbol) => {
    if (!targetSymbol || loading || activeRun) return;
    setLoading(true);
    setError(null);
    try {
      const started = await startResearch({ symbol: targetSymbol, strategyId });
      if (started) {
        setRuns((current) => [started, ...current.filter((run) => run.id !== started.id)]);
        // Remember this strategy for the symbol so the next run defaults to it.
        writePersisted(lastStrategyKey(targetSymbol), strategyId);
      } else {
        setError(t('research.notAvailable'));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
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
    if (!symbol) return;
    const created = await saveThesisFromReport(symbol);
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

  const symbolRuns = runs.filter((run) => run.symbol === symbol);

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
        {!symbol && <SymbolEntry error={symbolError} value={symbolInput} onChange={setSymbolInput} onSubmit={handleSymbolEntrySubmit} />}

        {symbol && (
          <ResearchMarketWorkspace
            symbol={symbol}
            report={report && report.symbol === symbol ? report : null}
            activeRun={Boolean(activeRun)}
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
          <ResearchReportView
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

const RunHistory: React.FC<{
  runs: ResearchRunSummary[];
  onSelect: (reportId: string) => void;
}> = ({ runs, onSelect }) => {
  const { t } = useTranslation();
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
            {t(`research.runStatus.${run.status}`)}
            {run.finishedAt ? ` · ${new Date(run.finishedAt).toLocaleTimeString()}` : ''}
          </span>
        </button>
      ))}
    </div>
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

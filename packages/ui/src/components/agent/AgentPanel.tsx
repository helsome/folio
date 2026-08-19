import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronLeft, Square, Sparkles } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ApiError, PortfolioSnapshot, Quote, ToolCall } from '@finagent/core';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  agentPanelVisibleAtom,
  cancelRunAtom,
  createSessionAtom,
  navSectionAtom,
  runViewAtom,
  settingsTabAtom,
  workspaceContextAtom,
  type NavSection,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { MessageList } from '../chat/MessageList';
import { MarkdownContent } from '../chat/MarkdownContent';
import { ModelSelector } from './ModelSelector';
import { ThinkingSelector } from './ThinkingSelector';
import { ToolActivity } from './ToolActivity';
import { ContextChip } from './ContextChip';
import { QuoteCard } from './structured/QuoteCard';
import { PortfolioRiskCard } from './structured/PortfolioRiskCard';

const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

// ---------------------------------------------------------------------------
// Defensive parsing of structured tool results (get_quote / get_portfolio).
// Results may be a plain object, a { data } wrapper, or a JSON string.
// ---------------------------------------------------------------------------

function unwrapStructuredResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: unknown }).data;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.lastPrice === 'number' && (typeof v.symbol === 'string' || typeof v.change === 'number');
}

function isPortfolio(value: unknown): value is PortfolioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.holdings);
}

function extractQuote(toolCalls: ToolCall[]): Quote | null {
  const call = toolCalls.find((tc) => tc.toolName === 'get_quote' && tc.status === 'success');
  if (!call) return null;
  const data = unwrapStructuredResult(call.result);
  if (!isQuote(data)) return null;
  const symbol =
    (typeof data.symbol === 'string' && data.symbol) ||
    (typeof call.args?.symbol === 'string' ? call.args.symbol : '');
  return { ...data, symbol: symbol || '—' };
}

function extractPortfolio(toolCalls: ToolCall[]): PortfolioSnapshot | null {
  const call = toolCalls.find((tc) => tc.toolName === 'get_portfolio' && tc.status === 'success');
  if (!call) return null;
  const data = unwrapStructuredResult(call.result);
  return isPortfolio(data) ? data : null;
}

// ---------------------------------------------------------------------------
// AgentPanel — the right-hand copilot.
// ---------------------------------------------------------------------------

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [messages] = useAtom(activeMessagesAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const [runView] = useAtom(runViewAtom);
  const setAgentPanelVisible = useSetAtom(agentPanelVisibleAtom);
  const createSession = useSetAtom(createSessionAtom);
  const cancelRun = useSetAtom(cancelRunAtom);
  const workspaceContext = useAtomValue(workspaceContextAtom);

  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const bodyEndRef = useRef<HTMLDivElement>(null);

  const isRunning = runView !== null && runView.infraError === undefined;

  useEffect(() => {
    bodyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, runView?.answer, runView?.toolCalls]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeSessionId || isRunning) return;

    setInput('');
    setSendError(null);
    const result = await client.kernel.startRun(activeSessionId, text, workspaceContext);
    if (!result.ok) {
      setSendError(result.error.message);
      setInput(text);
    }
  };

  /** V8.1 §38: retry the last user message after an infra failure. */
  const handleRetry = async () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser || !activeSessionId) return;
    setSendError(null);
    const result = await client.kernel.startRun(activeSessionId, lastUser.content, workspaceContext);
    if (!result.ok) {
      setSendError(result.error.message);
    }
  };

  const handleStop = async () => {
    await cancelRun(client);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!activeSessionId) {
    return (
      <aside
        data-testid="agent-panel"
        className="flex h-full w-full flex-col items-center justify-center border-l mac-section-divider bg-background"
      >
        <div className="px-6 text-center">
          <img
            src={folioLogoUrl}
            alt=""
            className="mx-auto mb-4 h-14 w-14 rounded-[16px] shadow-[0_14px_38px_rgba(var(--accent-rgb),0.18)]"
            draggable={false}
          />
          <h2 className="mb-2 text-[19px] font-semibold tracking-tight text-foreground">Copilot</h2>
          <p className="mb-5 text-[13px] leading-relaxed text-foreground/52">
            {t('agent.empty.body')}
          </p>
          <button
            onClick={() => void createSession(client)}
            className="mac-primary-button h-9 rounded-[10px] px-4 text-[13px] font-semibold transition-smooth active:scale-[0.985]"
          >
            {t('agent.empty.createSession')}
          </button>
        </div>
      </aside>
    );
  }

  const toolCalls = runView?.toolCalls ?? [];
  const quote = extractQuote(toolCalls);
  const portfolio = extractPortfolio(toolCalls);

  return (
    <aside
      data-testid="agent-panel"
      className="mac-sidebar flex h-full w-full flex-col border-l mac-section-divider"
    >
      {/* Header: model + thinking selectors and collapse affordance */}
      <div className="flex items-center gap-1.5 border-b mac-section-divider px-3 py-2.5">
        <ModelSelector disabled={isRunning} />
        <ThinkingSelector disabled={isRunning} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAgentPanelVisible(false)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-foreground/44 transition-smooth hover:bg-[var(--mac-sidebar-hover)] hover:text-foreground"
          aria-label={t('agent.panel.collapsePanel')}
          title={t('agent.panel.collapsePanel')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      {/* Workspace context chip */}
      <div className="border-b mac-section-divider px-3 py-2">
        <ContextChip />
      </div>

      {/* Scrollable body: tool activity, structured results, messages, live answer */}
      <div className="flex-1 overflow-y-auto scrollbar-hover">
        <div className="flex flex-col gap-3 p-3">
          {runView?.infraError && (
            <RuntimeInfraBanner
              error={runView.infraError}
              onRetry={() => void handleRetry()}
            />
          )}
          <ToolActivity toolCalls={toolCalls} />
          {quote && <QuoteCard quote={quote} />}
          {portfolio && <PortfolioRiskCard portfolio={portfolio} />}
          {messages.length === 0 && !isRunning && (
            <SuggestionChips
              onPick={(text) => {
                setInput(text);
                void handleSend();
              }}
            />
          )}
          <MessageList messages={messages} isLoading={isRunning} />
          {isRunning && <StreamingBlock answer={runView?.answer ?? ''} />}
          <div ref={bodyEndRef} />
        </div>
      </div>

      {/* Input / send / stop */}
      <div className="border-t mac-section-divider bg-surface px-3 py-3">
        <textarea
          data-testid="agent-input"
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? t('agent.panel.inputRunningPlaceholder') : t('agent.panel.inputPlaceholder')}
          disabled={isRunning}
          rows={2}
          className="mac-input w-full resize-none rounded-[14px] px-3 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-foreground/38 focus:border-[rgba(var(--accent-rgb),0.34)] focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
        />
        {sendError && <div className="mt-1.5 text-[11px] text-destructive">{sendError}</div>}
        <div className="mt-2 flex items-center justify-end gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={() => void handleStop()}
              className="flex items-center gap-1.5 rounded-full border border-destructive/30 px-3 py-1.5 text-[12px] font-semibold text-destructive transition-smooth hover:bg-destructive/10"
            >
              <Square className="h-3 w-3 fill-current" />
              {t('agent.panel.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              className="mac-primary-button flex h-9 w-9 items-center justify-center rounded-full transition-smooth active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('agent.panel.sendMessage')}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

/**
 * Contextual starter prompts (V9 §25). The empty-state suggestions follow the
 * current section instead of the same three prompts everywhere.
 */
const SUGGESTION_GROUP: Partial<Record<NavSection, string>> = {
  research: 'agent.suggestions.research',
  portfolio: 'agent.suggestions.portfolio',
  discover: 'agent.suggestions.discover',
  compare: 'agent.suggestions.compare',
  thesis: 'agent.suggestions.thesis',
  watchlist: 'agent.suggestions.watchlist',
  sessions: 'agent.suggestions.watchlist',
};

const SuggestionChips: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => {
  const { t } = useTranslation();
  const [navSection] = useAtom(navSectionAtom);
  const groupKey = SUGGESTION_GROUP[navSection] ?? 'agent.suggestions.default';
  const prompts = (t(groupKey, { returnObjects: true }) as string[]) ?? [];
  if (prompts.length === 0) return null;
  return (
    <div className="px-3 pb-1" data-testid="agent-suggestions">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/36">
        <Sparkles className="h-3 w-3" strokeWidth={1.8} />
        {t('agent.suggestions.title')}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {prompts.slice(0, 3).map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="max-w-full truncate rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-foreground/62 transition-smooth hover:border-border-strong hover:text-foreground"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Live streaming answer block while a run is executing. */
const StreamingBlock: React.FC<{ answer: string }> = ({ answer }) => {
  const { t } = useTranslation();
  return (
    <div data-testid="run-panel" className="rounded-[14px] border mac-section-divider bg-background/72 px-3.5 py-3 backdrop-blur-2xl">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-foreground/48">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {t('agent.panel.agentRunning')}
      </div>
      {answer.length > 0 ? (
        <MarkdownContent content={answer} className="text-[13px] text-foreground/72" />
      ) : (
        <div className="text-[13px] italic text-foreground/40">{t('agent.panel.thinking')}</div>
      )}
    </div>
  );
};

/** Map a runtime infra code to a user-facing reason key (V8.1 §38). */
function runtimeReasonKey(code: string | undefined): string {
  switch (code) {
    case 'PI_LLM_ENV_MISSING':
      return 'agent.runtime.reasonEnvMissing';
    case 'PI_RUNTIME_NOT_FOUND':
      return 'agent.runtime.reasonCommand';
    default:
      return 'agent.runtime.reasonUnknown';
  }
}

/**
 * V8.1 §38–39 — persistent route for *infrastructure* failures. Rendered
 * instead of an assistant-style chat message: distinct styling, an actionable
 * reason, Retry, and a Diagnostics shortcut. A successful retry clears it via
 * the run_started event (runAtoms clears infraError).
 */
const RuntimeInfraBanner: React.FC<{ error: ApiError; onRetry: () => void }> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();
  const setNavSection = useSetAtom(navSectionAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const openDiagnostics = (): void => {
    setSettingsTab('diagnostics');
    setNavSection('settings');
  };

  return (
    <div
      data-testid="runtime-infra-banner"
      role="alert"
      className="rounded-[14px] border border-destructive/26 bg-destructive/6 px-3.5 py-3 text-[13px]"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        <span className="font-semibold text-foreground">{t('agent.runtime.unavailable')}</span>
      </div>
      <p className="text-foreground/76">{t('agent.runtime.failedToStart')}</p>
      <p className="mt-1 text-foreground/56">{t(runtimeReasonKey(error.code))}</p>
      {error.action && (
        <p className="mt-1 text-[12px] text-foreground/46">{error.action}</p>
      )}
      <p className="mt-2 text-[11px] select-text break-words text-foreground/38">
        {t('agent.runtime.detailsLabel')}: {error.message}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="mac-primary-button h-8 rounded-[9px] px-3 text-[12px] font-semibold transition-smooth active:scale-[0.985]"
        >
          {t('agent.runtime.retry')}
        </button>
        <button
          type="button"
          onClick={openDiagnostics}
          className="h-8 rounded-[9px] border mac-section-divider px-3 text-[12px] font-medium text-foreground/72 transition-smooth hover:bg-foreground/6"
        >
          {t('agent.runtime.openDiagnostics')}
        </button>
      </div>
    </div>
  );
};

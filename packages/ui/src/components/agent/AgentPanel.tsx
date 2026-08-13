import React, { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { Portfolio, Quote, ToolCall } from '@finagent/core';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  agentPanelVisibleAtom,
  cancelRunAtom,
  createSessionAtom,
  runViewAtom,
  workspaceContextAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { MessageList } from '../chat/MessageList';
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

function isPortfolio(value: unknown): value is Portfolio {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.totalValue === 'number' && Array.isArray(v.positions);
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

function extractPortfolio(toolCalls: ToolCall[]): Portfolio | null {
  const call = toolCalls.find((tc) => tc.toolName === 'get_portfolio' && tc.status === 'success');
  if (!call) return null;
  const data = unwrapStructuredResult(call.result);
  return isPortfolio(data) ? data : null;
}

// ---------------------------------------------------------------------------
// AgentPanel — the right-hand copilot.
// ---------------------------------------------------------------------------

export const AgentPanel: React.FC = () => {
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

  const isRunning = runView !== null;

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
            Start a new session to explore markets with your agent.
          </p>
          <button
            onClick={() => void createSession(client)}
            className="mac-primary-button h-9 rounded-[10px] px-4 text-[13px] font-semibold transition-smooth active:scale-[0.985]"
          >
            Create New Session
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
          aria-label="Collapse agent panel"
          title="Collapse panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9.5 2.5 4 7l5.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Workspace context chip */}
      <div className="border-b mac-section-divider px-3 py-2">
        <ContextChip />
      </div>

      {/* Scrollable body: tool activity, structured results, messages, live answer */}
      <div className="flex-1 overflow-y-auto scrollbar-hover">
        <div className="flex flex-col gap-3 p-3">
          <ToolActivity toolCalls={toolCalls} />
          {quote && <QuoteCard quote={quote} />}
          {portfolio && <PortfolioRiskCard portfolio={portfolio} />}
          <MessageList messages={messages} isLoading={isRunning} />
          {isRunning && <StreamingBlock answer={runView?.answer ?? ''} />}
          <div ref={bodyEndRef} />
        </div>
      </div>

      {/* Input / send / stop */}
      <div className="border-t mac-section-divider bg-background/64 px-3 py-3 backdrop-blur-2xl">
        <textarea
          data-testid="agent-input"
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Agent is running…' : 'Ask the copilot…'}
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
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
                <rect x="1" y="1" width="8" height="8" rx="1.5" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              className="mac-primary-button flex h-9 w-9 items-center justify-center rounded-full transition-smooth active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Send message"
            >
              <svg width="15" height="15" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                <path d="M8.5 13.5v-10M8.5 3.5 4.2 7.8M8.5 3.5l4.3 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

/** Live streaming answer block while a run is executing. */
const StreamingBlock: React.FC<{ answer: string }> = ({ answer }) => {
  return (
    <div data-testid="run-panel" className="rounded-[14px] border mac-section-divider bg-background/72 px-3.5 py-3 backdrop-blur-2xl">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-foreground/48">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Agent running
      </div>
      {answer.length > 0 ? (
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/72">{answer}</div>
      ) : (
        <div className="text-[13px] italic text-foreground/40">Thinking…</div>
      )}
    </div>
  );
};

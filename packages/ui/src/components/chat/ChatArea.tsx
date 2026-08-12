import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { activeMessagesAtom, activeSessionIdAtom, createSessionAtom } from '../../atoms';
import { runViewAtom, cancelRunAtom } from '../../atoms/runAtoms';
import { useFinagentClient } from '../../client';
import { MessageList } from './MessageList';
import { Button } from '../primitives/Button';

const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

export const ChatArea: React.FC = () => {
  const client = useFinagentClient();
  const [messages] = useAtom(activeMessagesAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const [runView] = useAtom(runViewAtom);
  const cancelRun = useSetAtom(cancelRunAtom);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isRunning = runView !== null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, runView?.answer]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeSessionId || isRunning) return;

    setInput('');
    setSendError(null);
    const result = await client.kernel.startRun(activeSessionId, text);
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
      handleSend();
    }
  };

  if (!activeSessionId) {
    return (
      <main className="mac-main-surface flex flex-1 flex-col items-center justify-center">
        <div className="text-center max-w-md px-6">
          <img
            src={folioLogoUrl}
            alt=""
            className="mx-auto mb-5 h-20 w-20 rounded-[22px] shadow-[0_18px_50px_rgba(var(--accent-rgb),0.18)]"
            draggable={false}
          />
          <h1 className="mb-3 text-[28px] font-semibold tracking-tight text-foreground">Folio</h1>
          <p className="mb-6 text-[15px] leading-relaxed text-foreground/58">
            Start a new session to begin exploring market data and managing your portfolio.
          </p>
          <Button onClick={() => void createSession(client)} size="lg">Create New Session</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mac-main-surface flex flex-1 flex-col">
      <MessageList messages={messages} isLoading={isRunning} />
      {isRunning && <RunPanel answer={runView.answer} toolCalls={runView.toolCalls} onStop={() => void handleStop()} />}
      <div ref={messagesEndRef} />

      <div className="border-t mac-section-divider bg-background/64 px-5 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-3xl items-end gap-2.5">
          <div className="flex flex-1 flex-col">
            <textarea
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? 'Agent is running…' : 'Ask about quotes, portfolio, or market moves...'}
              disabled={isRunning}
              className="mac-input max-h-32 min-h-11 flex-1 resize-none rounded-[18px] px-4 py-3 text-[14px] leading-relaxed text-foreground placeholder:text-foreground/38 focus:border-[rgba(var(--accent-rgb),0.34)] focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
              rows={1}
            />
            {sendError && (
              <div className="mt-1.5 text-[12px] text-destructive">{sendError}</div>
            )}
          </div>
          <Button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isRunning}
            size="icon"
            className="h-11 w-11 rounded-full"
            aria-label="Send message"
          >
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <path d="M8.5 13.5v-10M8.5 3.5 4.2 7.8M8.5 3.5l4.3 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
      </div>
    </main>
  );
};

interface RunPanelProps {
  answer: string;
  toolCalls: Array<{ id: string; toolName: string; status: string }>;
  onStop: () => void;
}

const RunPanel: React.FC<RunPanelProps> = ({ answer, toolCalls, onStop }) => {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-2">
      <div className="rounded-[16px] border mac-section-divider bg-background/72 px-4 py-3 backdrop-blur-2xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-foreground/48">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Agent running
          </div>
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-full border border-destructive/30 px-3 py-1 text-[12px] font-semibold text-destructive transition-smooth hover:bg-destructive/10"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="8" height="8" rx="1.5" />
            </svg>
            Stop
          </button>
        </div>

        {toolCalls.length > 0 && (
          <div className="mb-2.5 space-y-1">
            {toolCalls.map((toolCall) => (
              <div
                key={toolCall.id}
                className="flex items-center gap-2.5 rounded-[10px] bg-foreground/[0.045] px-3 py-1.5 text-[12px]"
              >
                <span className="font-mono text-foreground/72">{toolCall.toolName}</span>
                <span className="flex-1" />
                {toolCall.status === 'running' && (
                  <span className="flex items-center gap-1.5 text-foreground/46">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    running
                  </span>
                )}
                {toolCall.status === 'success' && (
                  <span className="font-semibold text-success">done</span>
                )}
                {toolCall.status === 'error' && (
                  <span className="font-semibold text-destructive">failed</span>
                )}
              </div>
            ))}
          </div>
        )}

        {answer.length > 0 && (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/72">
            {answer}
          </div>
        )}
      </div>
    </div>
  );
};

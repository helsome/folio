import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { activeMessagesAtom, addMessageAtom, activeSessionIdAtom, createSessionAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { MessageList } from './MessageList';
import { Button } from '../primitives/Button';
import type { Message } from '@finagent/core';

const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

export const ChatArea: React.FC = () => {
  const client = useFinagentClient();
  const [messages] = useAtom(activeMessagesAtom);
  const addMessage = useSetAtom(addMessageAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !activeSessionId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    addMessage(userMessage);
    setInput('');
    setIsLoading(true);

    try {
      const response = await client.agent.send({
        sessionId: activeSessionId,
        content: input.trim(),
      });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.ok ? response.data.answer : response.error.message,
        timestamp: Date.now(),
        toolName: response.ok ? response.data.toolName : undefined,
        toolCalls: response.ok ? response.data.toolCalls : undefined,
        trace: response.ok ? response.data.trace : undefined,
      };

      addMessage(assistantMessage);
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
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
          <Button onClick={() => createSession()} size="lg">Create New Session</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mac-main-surface flex flex-1 flex-col">
      <MessageList messages={messages} isLoading={isLoading} />
      <div ref={messagesEndRef} />

      <div className="border-t mac-section-divider bg-background/64 px-5 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-3xl items-end gap-2.5">
          <textarea
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about quotes, portfolio, or market moves..."
            className="mac-input max-h-32 min-h-11 flex-1 resize-none rounded-[18px] px-4 py-3 text-[14px] leading-relaxed text-foreground placeholder:text-foreground/38 focus:border-[rgba(var(--accent-rgb),0.34)] focus:outline-none focus:ring-2 focus:ring-accent/25"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
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

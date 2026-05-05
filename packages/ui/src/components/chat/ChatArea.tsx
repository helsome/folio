import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { activeMessagesAtom, addMessageAtom, activeSessionIdAtom, createSessionAtom } from '@finagent/ui';
import { MessageList } from './MessageList';
import { Button } from '../primitives/Button';
import type { Message } from '@finagent/core';

export const ChatArea: React.FC = () => {
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
      // TODO: Send to Pi Agent
      const response = await window.electronAPI?.piAgent.send({
        type: 'chat',
        content: input.trim(),
      });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: typeof response === 'string' ? response : JSON.stringify(response),
        timestamp: Date.now(),
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
      <main className="flex-1 flex flex-col items-center justify-center bg-[oklch(var(--bg-primary))]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Welcome to Finance Agent</h1>
          <p className="text-[oklch(var(--text-secondary))] mb-6">
            Start a new session to begin exploring market data and managing your portfolio.
          </p>
          <Button onClick={() => createSession()}>Create New Session</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col bg-[oklch(var(--bg-primary))]">
      <MessageList messages={messages} isLoading={isLoading} />
      <div ref={messagesEndRef} />

      {/* Input Area */}
      <div className="p-4 border-t border-[oklch(var(--bg-secondary))]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 rounded-lg border border-[oklch(var(--bg-secondary))] bg-[oklch(var(--bg-primary))] text-[oklch(var(--text-primary))] resize-none focus:outline-none focus:ring-2 focus:ring-[oklch(var(--accent-primary))]"
            rows={1}
          />
          <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
            Send
          </Button>
        </div>
      </div>
    </main>
  );
};
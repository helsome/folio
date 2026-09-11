import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Message, Run } from '@finagent/core';
import { TurnCard } from './TurnCard';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  runs?: Run[];
  onEdit?: (message: Message, content: string) => Promise<boolean>;
  onRegenerate?: (message: Message) => Promise<boolean>;
  onRetry?: (message: Message) => Promise<boolean>;
  onFork?: (message: Message) => Promise<boolean>;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, runs = [], onEdit, onRegenerate, onRetry, onFork }) => {
  const { t } = useTranslation();
  const runById = new Map(runs.map((run) => [run.id, run]));
  return (
    <div className="flex-1 overflow-y-auto px-0.5 py-0">
      {/* Inside the 400px Copilot panel the shell already pads the body; no max-width rail. */}
      <div className="max-w-none space-y-3">
        {messages.map((message) => (
          <TurnCard
            key={message.id}
            message={message}
            run={message.runId ? runById.get(message.runId) : undefined}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onRetry={onRetry}
            onFork={onFork}
          />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-foreground/48">
            <div className="h-2 w-2 animate-pulse rounded-full bg-accent/70" />
            <div className="animate-pulse">{t('agent.panel.thinking')}</div>
          </div>
        )}
        {messages.length === 0 && !isLoading && (
          <div className="py-12 text-center text-[14px] text-foreground/48">
            <p>{t('agent.chat.noMessages')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

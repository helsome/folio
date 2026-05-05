import React from 'react';
import type { Message } from '@finagent/core';
import { TurnCard } from './TurnCard';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isLoading }) => {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((message) => (
          <TurnCard key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-[oklch(var(--text-secondary))]">
            <div className="animate-pulse">Thinking...</div>
          </div>
        )}
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-12 text-[oklch(var(--text-secondary))]">
            <p>No messages yet. Start the conversation!</p>
          </div>
        )}
      </div>
    </div>
  );
};
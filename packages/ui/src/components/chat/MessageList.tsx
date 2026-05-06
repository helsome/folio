import React from 'react';
import type { Message } from '@finagent/core';
import { TurnCard } from './TurnCard';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isLoading }) => {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((message) => (
          <TurnCard key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-foreground/48">
            <div className="h-2 w-2 animate-pulse rounded-full bg-accent/70" />
            <div className="animate-pulse">Thinking...</div>
          </div>
        )}
        {messages.length === 0 && !isLoading && (
          <div className="py-12 text-center text-[14px] text-foreground/48">
            <p>No messages yet. Start the conversation!</p>
          </div>
        )}
      </div>
    </div>
  );
};

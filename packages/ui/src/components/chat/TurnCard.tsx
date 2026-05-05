import React from 'react';
import type { Message } from '@finagent/core';

interface TurnCardProps {
  message: Message;
}

export const TurnCard: React.FC<TurnCardProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[70%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-[oklch(var(--accent-primary))] text-white'
            : isTool
            ? 'bg-[oklch(var(--bg-secondary))] text-[oklch(var(--text-secondary))] border border-[oklch(var(--accent-primary))]'
            : 'bg-[oklch(var(--bg-secondary))] text-[oklch(var(--text-primary))]'
        }`}
      >
        {isTool && message.toolName && (
          <div className="text-xs font-medium mb-1 text-[oklch(var(--accent-primary))]">
            Tool: {message.toolName}
          </div>
        )}
        <div className="prose prose-sm max-w-none">
          {message.content}
        </div>
        <div className={`text-xs mt-1 ${isUser ? 'text-white/70' : 'text-[oklch(var(--text-secondary))]'}`}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@finagent/core';
import { AnswerContent } from './AnswerContent';
import { ToolActivity } from '../agent/ToolActivity';

interface TurnCardProps {
  message: Message;
}

export const TurnCard: React.FC<TurnCardProps> = ({ message }) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const toolCalls = message.toolCalls ?? [];

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[88%] rounded-[10px] px-3.5 py-3 ${
          isUser
            ? 'mac-message-user rounded-br-[4px]'
            : isTool
            ? 'mac-message-assistant rounded-bl-[6px] text-foreground'
            : 'mac-message-assistant rounded-bl-[4px] text-foreground'
        }`}
      >
        {isTool && message.toolName && (
          <div className="mb-1.5 text-[12px] font-semibold text-accent">
            {t('agent.tool.label', { name: message.toolName })}
          </div>
        )}
        {isUser ? (
          <div className="max-w-none whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</div>
        ) : (
          <AnswerContent content={message.content} />
        )}
        {!isUser && toolCalls.length > 0 && (
          <div className="mt-3 border-t mac-section-divider pt-3">
            <ToolActivity toolCalls={toolCalls} />
          </div>
        )}
        <div className={`mt-2 text-[11px] ${isUser ? 'text-white/68' : 'text-foreground/38'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

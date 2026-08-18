import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '@finagent/core';
import { MarkdownContent } from './MarkdownContent';

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
          <MarkdownContent content={message.content} />
        )}
        {!isUser && toolCalls.length > 0 && (
          <div className="mt-3 border-t mac-section-divider pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase text-foreground/42">
              {t('agent.tool.calls')}
            </div>
            <div className="space-y-1.5">
              {toolCalls.map((toolCall) => (
                <div
                  key={toolCall.id}
                  className="flex items-center justify-between gap-3 rounded-[10px] bg-foreground/[0.045] px-3 py-2 text-[12px]"
                >
                  <span className="truncate font-mono text-foreground/68">
                    {toolCall.toolName}
                  </span>
                  <span
                    className={
                      toolCall.status === 'success'
                        ? 'font-semibold text-success'
                        : 'font-semibold text-destructive'
                    }
                  >
                    {toolCall.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={`mt-2 text-[11px] ${isUser ? 'text-white/68' : 'text-foreground/38'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

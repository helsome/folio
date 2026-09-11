import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import type { Message } from '@finagent/core';
import { AnswerContent } from './AnswerContent';
import { SourceInspector } from './SourceInspector';
import { ToolActivity } from '../agent/ToolActivity';
import { collectCitationSources } from '../../lib/citations';

interface TurnCardProps {
  message: Message;
}

export const TurnCard: React.FC<TurnCardProps> = ({ message }) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const toolCalls = message.toolCalls ?? [];
  const isAssistant = !isUser && !isTool;

  // #30: provenance surface for this assistant turn.
  const citationIndex = useMemo(
    () => (isAssistant ? collectCitationSources(message) : { sources: [], byId: new Map() }),
    [message, isAssistant]
  );
  const [inspectorFocus, setInspectorFocus] = useState<string | undefined>(undefined);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const openInspector = (sourceId?: string) => {
    setInspectorFocus(sourceId);
    setInspectorOpen(true);
  };

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
          <AnswerContent
            content={message.content}
            message={isAssistant ? message : undefined}
            onOpenSource={isAssistant ? (sourceId) => openInspector(sourceId) : undefined}
          />
        )}
        {!isUser && toolCalls.length > 0 && (
          <div className="mt-3 border-t mac-section-divider pt-3">
            <ToolActivity toolCalls={toolCalls} />
          </div>
        )}
        {isAssistant && (
          <div className="mt-2 flex items-center gap-3">
            <span className={`text-[11px] ${isUser ? 'text-white/68' : 'text-foreground/38'}`}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {citationIndex.sources.length > 0 && (
              <button
                type="button"
                data-testid="open-source-inspector"
                onClick={() => openInspector()}
                className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] text-foreground/48 transition-smooth hover:bg-foreground/6 hover:text-foreground"
              >
                <BookOpen className="h-3 w-3" />
                {t('agent.sources.count', { count: citationIndex.sources.length })}
              </button>
            )}
          </div>
        )}
      </div>
      {isAssistant && inspectorOpen && (
        <SourceInspector
          message={message}
          focusSourceId={inspectorFocus}
          onClose={() => setInspectorOpen(false)}
        />
      )}
    </div>
  );
};

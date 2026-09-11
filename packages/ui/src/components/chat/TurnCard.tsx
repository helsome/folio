import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message, Run } from '@finagent/core';
import { AnswerContent } from './AnswerContent';
import { ToolActivity } from '../agent/ToolActivity';

interface TurnCardProps {
  message: Message;
  run?: Run;
  onEdit?: (message: Message, content: string) => Promise<boolean>;
  onRegenerate?: (message: Message) => Promise<boolean>;
  onRetry?: (message: Message) => Promise<boolean>;
  onFork?: (message: Message) => Promise<boolean>;
}

export const TurnCard: React.FC<TurnCardProps> = ({ message, run, onEdit, onRegenerate, onRetry, onFork }) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const toolCalls = message.toolCalls ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [busy, setBusy] = useState(false);

  const invoke = async (action: (() => Promise<boolean>) | undefined) => {
    if (!action || busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const content = draft.trim();
    if (!content || !onEdit) return;
    await invoke(async () => {
      const ok = await onEdit(message, content);
      if (ok) setEditing(false);
      return ok;
    });
  };

  const canRetry = run?.status === 'failed' || run?.status === 'cancelled';
  const canRegenerate = message.role === 'assistant' && run?.status === 'completed';

  return (
    <div
      className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}
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
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              rows={3}
              className="mac-input w-full resize-none px-2.5 py-2 text-[14px] leading-relaxed text-foreground focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => { setDraft(message.content); setEditing(false); }}
                disabled={busy}
                className="rounded-[6px] px-2 py-1 text-[11px] text-foreground/56 hover:bg-foreground/8 disabled:opacity-50"
              >
                {t('agent.actions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={busy || !draft.trim()}
                className="rounded-[6px] bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {t('agent.actions.save')}
              </button>
            </div>
          </div>
        ) : isUser ? (
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
        {!isTool && !editing && (
          <div className="mt-2 flex flex-wrap justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {isUser && onEdit && (
              <button
                type="button"
                onClick={() => { setDraft(message.content); setEditing(true); }}
                disabled={busy}
                className="rounded-[6px] px-2 py-1 text-[10px] text-foreground/48 hover:bg-foreground/8 hover:text-foreground disabled:opacity-50"
              >
                {t('agent.actions.edit')}
              </button>
            )}
            {canRegenerate && onRegenerate && (
              <button
                type="button"
                onClick={() => void invoke(() => onRegenerate(message))}
                disabled={busy}
                className="rounded-[6px] px-2 py-1 text-[10px] text-foreground/48 hover:bg-foreground/8 hover:text-foreground disabled:opacity-50"
              >
                {t('agent.actions.regenerate')}
              </button>
            )}
            {canRetry && onRetry && (
              <button
                type="button"
                onClick={() => void invoke(() => onRetry(message))}
                disabled={busy}
                className="rounded-[6px] px-2 py-1 text-[10px] text-foreground/48 hover:bg-foreground/8 hover:text-foreground disabled:opacity-50"
              >
                {t('agent.actions.retry')}
              </button>
            )}
            {onFork && (
              <button
                type="button"
                onClick={() => void invoke(() => onFork(message))}
                disabled={busy}
                className="rounded-[6px] px-2 py-1 text-[10px] text-foreground/48 hover:bg-foreground/8 hover:text-foreground disabled:opacity-50"
              >
                {t('agent.actions.fork')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

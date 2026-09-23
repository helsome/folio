import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import type { ApiError, ToolCall } from '@finagent/core';
import { semanticToolLabelKey } from '../../lib/agentPresentation';

type ToolActivityCall = Pick<ToolCall, 'id' | 'toolName' | 'args' | 'startedAt' | 'completedAt' | 'status'> & {
  error?: ApiError;
};

interface ToolActivityProps { toolCalls: ToolActivityCall[]; }

const StatusIcon: React.FC<{ status: ToolActivityCall['status'] }> = ({ status }) => {
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />;
  if (status === 'success') return <Check className="h-3.5 w-3.5 shrink-0 text-positive" />;
  return <X className="h-3.5 w-3.5 shrink-0 text-negative" />;
};

function formatDuration(startedAt: number, completedAt: number | undefined): string | null {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt! < startedAt) return null;
  return `${((completedAt! - startedAt) / 1000).toFixed(1)}s`;
}

function displaySymbol(args: Record<string, unknown>): string | null {
  const symbol = args.symbol;
  if (typeof symbol !== 'string') return null;
  const normalized = symbol.trim().toUpperCase();
  return /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/.test(normalized) ? normalized : null;
}

/** Compact, collapsible tool timeline for live and persisted agent runs. */
export const ToolActivity: React.FC<ToolActivityProps> = ({ toolCalls }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (toolCalls.length === 0) return null;
  const running = toolCalls.some((call) => call.status === 'running');
  const failed = toolCalls.some((call) => call.status === 'error');
  return <div className="rounded-[9px] border border-border bg-surface-muted px-3 py-2">
    <button data-testid="tool-activity-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left text-[11px] text-foreground/64">
      <span className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse bg-accent' : failed ? 'bg-negative' : 'bg-positive'}`} />
      <span className="font-medium">{running ? t('agent.tool.running') : t('agent.tool.analyzedSources', { count: toolCalls.length })}</span>
      <span className="flex-1" /><ChevronDown className={`h-3.5 w-3.5 text-foreground/34 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="mt-2 space-y-1.5 border-t border-border pt-2">
      {toolCalls.map((toolCall) => {
        const symbol = displaySymbol(toolCall.args);
        const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
        return <div key={toolCall.id} data-testid="tool-activity-call" className="flex items-center gap-2 text-[11px]">
        <StatusIcon status={toolCall.status} />
        <span className="truncate text-foreground/78">{t(semanticToolLabelKey(toolCall.toolName))}</span>
        {symbol && <span className="rounded-[5px] bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/52">{symbol}</span>}
        <span className="flex-1" />
        {toolCall.status === 'running' && <span className="text-foreground/38">{t('agent.tool.statusRunning')}</span>}
        {duration && <span className="font-mono text-[9.5px] text-foreground/40">{duration}</span>}
        {toolCall.status === 'error' && <span className="text-[9.5px] text-negative/75">{t('agent.tool.failed')}</span>}
      </div>;
      })}
    </div>}
  </div>;
};

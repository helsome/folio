import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import type { ToolCall } from '@finagent/core';
import { semanticToolLabelKey } from '../../lib/agentPresentation';

interface ToolActivityProps { toolCalls: ToolCall[]; }

const StatusIcon: React.FC<{ status: ToolCall['status'] }> = ({ status }) => {
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />;
  if (status === 'success') return <Check className="h-3.5 w-3.5 shrink-0 text-positive" />;
  return <X className="h-3.5 w-3.5 shrink-0 text-negative" />;
};

/** Compact, collapsible tool timeline for the current agent run. */
export const ToolActivity: React.FC<ToolActivityProps> = ({ toolCalls }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (toolCalls.length === 0) return null;
  const running = toolCalls.some((call) => call.status === 'running');
  return <div className="rounded-[9px] border border-border bg-surface-muted px-3 py-2">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left text-[11px] text-foreground/64">
      <span className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse bg-accent' : 'bg-positive'}`} />
      <span className="font-medium">{running ? t('agent.tool.running') : t('agent.tool.analyzedSources', { count: toolCalls.length })}</span>
      <span className="flex-1" /><ChevronDown className={`h-3.5 w-3.5 text-foreground/34 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="mt-2 space-y-1.5 border-t border-border pt-2">
      {toolCalls.map((toolCall) => { const symbol = typeof toolCall.args?.symbol === 'string' ? toolCall.args.symbol : null; return <div key={toolCall.id} className="flex items-center gap-2 text-[11px]">
        <StatusIcon status={toolCall.status} />
        <span className="truncate text-foreground/78">{t(semanticToolLabelKey(toolCall.toolName))}</span>
        {symbol && <span className="rounded-[5px] bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/52">{symbol}</span>}
        <span className="flex-1" />
        {toolCall.status === 'running' && <span className="text-foreground/38">{t('agent.tool.statusRunning')}</span>}
        {/* technical detail, collapsed into a muted suffix — never the default label */}
        {toolCall.status !== 'running' && <span className="font-mono text-[9.5px] text-foreground/30">{toolCall.toolName}</span>}
      </div>; })}
    </div>}
  </div>;
};

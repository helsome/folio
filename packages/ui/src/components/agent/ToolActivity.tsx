import React from 'react';
import type { ToolCall } from '@finagent/core';

interface ToolActivityProps {
  toolCalls: ToolCall[];
}

const StatusIcon: React.FC<{ status: ToolCall['status'] }> = ({ status }) => {
  if (status === 'running') {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'success') {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mac-green)]" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mac-red)]" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

/** Live tool-call status list for the currently running agent. */
export const ToolActivity: React.FC<ToolActivityProps> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null;

  return (
    <div className="rounded-[12px] border mac-section-divider bg-background/60 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/42">
        Tool activity
      </div>
      <div className="space-y-1.5">
        {toolCalls.map((toolCall) => {
          const symbol = typeof toolCall.args?.symbol === 'string' ? toolCall.args.symbol : null;
          return (
            <div key={toolCall.id} className="flex items-center gap-2 text-[12px]">
              <StatusIcon status={toolCall.status} />
              <span className="truncate font-mono text-foreground/72">{toolCall.toolName}</span>
              {symbol && (
                <span className="shrink-0 rounded-[6px] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-foreground/56">
                  {symbol}
                </span>
              )}
              <span className="flex-1" />
              {toolCall.status === 'running' && (
                <span className="shrink-0 text-foreground/42">running</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

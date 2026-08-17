import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Brain, LoaderCircle } from 'lucide-react';
import { useAtom, useSetAtom } from 'jotai';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { hydrateLlmAtom, llmStateAtom, setLlmThinkingAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

interface ThinkingSelectorProps { disabled?: boolean; }
const capitalize = (value: string): string => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

export const ThinkingSelector: React.FC<ThinkingSelectorProps> = ({ disabled = false }) => {
  const client = useFinagentClient();
  const [state] = useAtom(llmStateAtom);
  const hydrate = useSetAtom(hydrateLlmAtom);
  const setThinking = useSetAtom(setLlmThinkingAtom);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void hydrate(client); }, [client, hydrate]);
  const levels = state.availableThinkingLevels;
  const effectiveDisabled = disabled || levels.length === 0 || busy;
  const handleSelect = async (level: string) => {
    setBusy(true); setError(null);
    const result = await setThinking({ client, level });
    setBusy(false);
    if (!result.ok) setError(result.error.message); else setOpen(false);
  };
  return <div>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={effectiveDisabled} aria-label="Reasoning" title={levels.length === 0 ? 'Thinking levels unavailable in this runtime' : undefined} className="flex max-w-[145px] items-center gap-1.5 rounded-[8px] border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-foreground/72 transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45">
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" /> : <Brain className="h-3.5 w-3.5 text-foreground/42" />}<span className="truncate">Reasoning: {capitalize(state.thinkingLevel)}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/42" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {levels.map((level) => <DropdownMenuItem key={level} onSelect={() => void handleSelect(level)}><span className="flex-1">{capitalize(level)}</span>{level === state.thinkingLevel && <Check className="h-3.5 w-3.5 text-accent" />}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <div className="mt-1 text-[11px] text-destructive">{error}</div>}
  </div>;
};

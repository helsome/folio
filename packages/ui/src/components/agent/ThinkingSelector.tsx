import React, { useEffect, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { hydrateLlmAtom, llmStateAtom, setLlmThinkingAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

interface ThinkingSelectorProps {
  disabled?: boolean;
}

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
    aria-hidden="true"
  >
    <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0 text-accent" aria-hidden="true">
    <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Reasoning / thinking-level picker driven by the active model's supported levels. */
export const ThinkingSelector: React.FC<ThinkingSelectorProps> = ({ disabled = false }) => {
  const client = useFinagentClient();
  const [state] = useAtom(llmStateAtom);
  const hydrate = useSetAtom(hydrateLlmAtom);
  const setThinking = useSetAtom(setLlmThinkingAtom);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrate(client);
  }, [client, hydrate]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const levels = state.availableThinkingLevels;
  const levelsEmpty = levels.length === 0;
  const effectiveDisabled = disabled || levelsEmpty || busy;

  const handleSelect = async (level: string) => {
    setBusy(true);
    setError(null);
    const result = await setThinking({ client, level });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={effectiveDisabled}
        title={levelsEmpty ? 'Thinking levels unavailable in this runtime' : undefined}
        className="flex max-w-[150px] items-center gap-1.5 rounded-[10px] border border-[var(--mac-border)] bg-[var(--mac-control)] px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 transition-smooth hover:bg-[var(--mac-control-hover)] disabled:cursor-not-allowed disabled:opacity-45"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">Reasoning: {capitalize(state.thinkingLevel)}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-(--z-index-dropdown) mt-1.5 max-h-72 w-44 overflow-y-auto rounded-[12px] border border-[var(--mac-border)] bg-[var(--mac-surface-solid)] shadow-middle"
        >
          {levels.map((level) => {
            const isCurrent = level === state.thinkingLevel;
            return (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => void handleSelect(level)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-smooth hover:bg-[var(--mac-sidebar-hover)] ${
                  isCurrent ? 'text-foreground' : 'text-foreground/72'
                }`}
              >
                <span className="truncate">{capitalize(level)}</span>
                {isCurrent && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
      {error && <div className="mt-1 text-[11px] text-destructive">{error}</div>}
    </div>
  );
};

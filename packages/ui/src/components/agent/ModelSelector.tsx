import React, { useEffect, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import type { LlmModel } from '@finagent/core';
import {
  groupModelsByProvider,
  hydrateLlmAtom,
  llmModelsAtom,
  llmStateAtom,
  refreshLlmModelsAtom,
  setLlmModelAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';

interface ModelSelectorProps {
  disabled?: boolean;
}

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

/** Registry-driven model picker grouped by provider. */
export const ModelSelector: React.FC<ModelSelectorProps> = ({ disabled = false }) => {
  const client = useFinagentClient();
  const [state] = useAtom(llmStateAtom);
  const [models] = useAtom(llmModelsAtom);
  const hydrate = useSetAtom(hydrateLlmAtom);
  const refreshModels = useSetAtom(refreshLlmModelsAtom);
  const setModel = useSetAtom(setLlmModelAtom);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrate(client);
    void refreshModels(client);
  }, [client, hydrate, refreshModels]);

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

  const groups = groupModelsByProvider(models);
  const current = state.model;

  const currentLabel = state.loading
    ? 'Loading models…'
    : current
      ? current.name || `${current.provider}/${current.id}`
      : 'Select model';

  const handleSelect = async (provider: string, modelId: string) => {
    setBusy(true);
    setError(null);
    const result = await setModel({ client, provider, modelId });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        className="flex max-w-[180px] items-center gap-1.5 rounded-[10px] border border-[var(--mac-border)] bg-[var(--mac-control)] px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 transition-smooth hover:bg-[var(--mac-control-hover)] disabled:cursor-not-allowed disabled:opacity-45"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-[--z-index-dropdown] mt-1.5 max-h-72 w-64 overflow-y-auto rounded-[12px] border border-[var(--mac-border)] bg-[var(--mac-surface-solid)] shadow-middle"
        >
          {groups.length === 0 && !state.loading && (
            <div className="px-3 py-4 text-center text-[12px] text-foreground/42">No models available</div>
          )}
          {groups.map((group) => (
            <div key={group.provider}>
              <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
                {group.provider}
              </div>
              {group.models.map((model: LlmModel) => {
                const isCurrent = current && current.provider === model.provider && current.id === model.id;
                return (
                  <button
                    key={`${model.provider}/${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => void handleSelect(model.provider, model.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-smooth hover:bg-[var(--mac-sidebar-hover)] ${
                      isCurrent ? 'text-foreground' : 'text-foreground/72'
                    }`}
                  >
                    <span className="truncate">{model.name || model.id}</span>
                    {isCurrent && <CheckIcon />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-1 text-[11px] text-destructive">{error}</div>}
      {!error && state.error && <div className="mt-1 text-[11px] text-foreground/42">{state.error}</div>}
    </div>
  );
};

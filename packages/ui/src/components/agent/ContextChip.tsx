import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { activeSymbolAtom, activeViewAtom } from '../../atoms';

/** Current workspace focus ("NVDA.US · chart") with a clear affordance. */
export const ContextChip: React.FC = () => {
  const [activeSymbol] = useAtom(activeSymbolAtom);
  const [activeView] = useAtom(activeViewAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);

  if (!activeSymbol) {
    return (
      <div
        data-testid="context-chip"
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--mac-border)] px-2.5 py-1 text-[11px] text-foreground/38"
      >
        No security context
      </div>
    );
  }

  return (
    <div
      data-testid="context-chip"
      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[var(--mac-blue-soft)] px-2.5 py-1 text-[11px] font-medium"
    >
      <span className="font-semibold text-foreground">{activeSymbol}</span>
      <span className="text-foreground/34">·</span>
      <span className="text-foreground/62">{activeView}</span>
      <button
        type="button"
        onClick={() => setActiveSymbol(null)}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-foreground/44 transition-smooth hover:bg-foreground/10 hover:text-foreground"
        aria-label="Clear security context"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
          <path d="M2 2l5 5M7 2L2 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};

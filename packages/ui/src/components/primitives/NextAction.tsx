import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

/**
 * NextAction — a small, contextual "what to do next" strip shown after a task
 * completes (V9 §11–12). One primary action, up to one secondary, plus a short
 * hint line. Deliberately quiet: not a giant onboarding banner.
 */
export interface NextActionProps {
  /** Primary action (required — a completed task must never dead-end). */
  primaryLabel: string;
  onPrimary: () => void;
  /** Optional secondary action. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Short contextual hint under the actions. */
  hint?: string;
  /** data-testid for E2E / interaction probes. */
  testId?: string;
}

export const NextAction: React.FC<NextActionProps> = ({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  hint,
  testId,
}) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId ?? 'next-action'}
      className="rounded-[10px] border border-accent/24 bg-accent/4 px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-accent">
          {t('research.next.title')}
        </span>
        <div className="flex-1" />
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="h-8 rounded-[8px] border border-border px-3 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-border-strong hover:text-foreground"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onPrimary}
          className="mac-primary-button flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold transition-smooth active:scale-[0.985]"
        >
          {primaryLabel}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-foreground/52">{hint}</p>}
    </div>
  );
};

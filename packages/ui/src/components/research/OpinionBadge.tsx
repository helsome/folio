import React from 'react';
import { useTranslation } from 'react-i18next';
import type { OpinionStance, ResearchOpinion } from '@finagent/core';

const STANCE_TONE: Record<OpinionStance, string> = {
  bullish: 'text-positive',
  bearish: 'text-negative',
  neutral: 'text-text-muted',
};

const HORIZON_LABEL: Record<ResearchOpinion['horizon'], string> = {
  '1w': '1W',
  '1m': '1M',
  '3m': '3M',
};

/**
 * Compact stance + confidence + horizon badge for a research opinion.
 * `undefined` renders the graceful gray state (no opinion yet).
 */
export const OpinionBadge: React.FC<{ opinion?: ResearchOpinion }> = ({ opinion }) => {
  const { t } = useTranslation();
  if (!opinion) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--mac-border)] px-2.5 py-1 text-[11px] text-foreground/38"
        data-testid="opinion-badge"
      >
        {t('research.opinion.none')}
      </span>
    );
  }
  const confidence = Math.round(opinion.confidence * 100);
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[var(--mac-blue-soft)] px-2.5 py-1 text-[11px]"
      data-testid="opinion-badge"
      title={t('research.opinion.title', {
        stance: t(`research.opinion.stance.${opinion.stance}`),
        confidence,
        horizon: HORIZON_LABEL[opinion.horizon],
      })}
    >
      <span className={`font-semibold ${STANCE_TONE[opinion.stance]}`}>
        {t(`research.opinion.stance.${opinion.stance}`)}
      </span>
      <span className="text-foreground/56">{confidence}%</span>
      <span className="rounded-[5px] border border-[var(--mac-border)] px-1.5 py-0.5 font-mono text-[10px] text-foreground/56">
        {HORIZON_LABEL[opinion.horizon]}
      </span>
    </span>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThesisImpact, ThesisImpactKind } from '@finagent/core';

const KIND_BADGE: Record<ThesisImpactKind, { color: string }> = {
  unchanged: { color: '#9ca3af' },
  strengthened: { color: '#22c55e' },
  weakened: { color: '#f59e0b' },
  invalidated: { color: '#ef4444' },
};

/** Impact history: kind badge + evaluator summary + date. */
export const ThesisImpactList: React.FC<{ impacts: ThesisImpact[] }> = ({ impacts }) => {
  const { t } = useTranslation();
  if (impacts.length === 0) {
    return (
      <div className="py-6 text-center text-[13px] text-foreground/44">{t('thesis.impact.noneYet')}</div>
    );
  }

  return (
    <div className="space-y-2">
      {impacts.map((impact) => {
        const badge = KIND_BADGE[impact.kind];
        return (
          <div key={impact.id} className="rounded-[10px] border border-foreground/8 p-3">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: badge.color }}
              >
                {t(`thesis.impact.${impact.kind}`)}
              </span>
              <span className="text-[11px] text-foreground/44">
                {new Date(impact.evaluatedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">{impact.summary}</p>
          </div>
        );
      })}
    </div>
  );
};

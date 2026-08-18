import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DiffCategory,
  DiffDirection,
  ResearchChange,
  ResearchDiff,
  ResearchReport,
} from '@finagent/core';

const DIRECTION_META: Record<DiffDirection, { arrow: string; tone: string }> = {
  improved: { arrow: '▲', tone: 'text-positive' },
  worsened: { arrow: '▼', tone: 'text-negative' },
  unchanged: { arrow: '=', tone: 'text-text-muted' },
  new: { arrow: '+', tone: 'text-positive' },
  removed: { arrow: '−', tone: 'text-text-muted' },
};

type ImpactDirection = NonNullable<ResearchDiff['thesisImpact']>['direction'];

const IMPACT_TONE: Record<ImpactDirection, string> = {
  invalidated: 'text-negative',
  weakened: 'text-negative',
  strengthened: 'text-positive',
  unchanged: 'text-text-muted',
};

export interface WhatChangedSectionProps {
  diff: ResearchDiff;
  /** Previous report — supplies the "Since" date for the header. */
  previousReport?: ResearchReport;
}

/**
 * What Changed — the delta between the previous research report and the
 * current one. The diff stays structured (stored English labels/prose are
 * never translated); only the surrounding interpretation chrome follows the
 * current UI locale.
 */
export const WhatChangedSection: React.FC<WhatChangedSectionProps> = ({ diff, previousReport }) => {
  const { t } = useTranslation();
  const materialRows = diff.changes.filter((change) => change.material);
  const impact = diff.thesisImpact;
  return (
    <section className="rounded-[10px] border mac-list-row p-4" data-testid="what-changed">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {t('research.whatChanged')}
        </h4>
        {previousReport && (
          <span className="text-[11px] text-text-muted">
            {t('research.since', {
              date: new Date(previousReport.generatedAt).toLocaleDateString(),
            })}
          </span>
        )}
      </div>

      {impact && impact.direction !== 'unchanged' && (
        <div className="mt-2.5 rounded-[8px] bg-foreground/4 px-3 py-2" data-testid="thesis-impact">
          <span
            className={`text-[10.5px] font-bold uppercase tracking-wide ${
              IMPACT_TONE[impact.direction]
            }`}
          >
            {t(`research.impact.${impact.direction}`)}
          </span>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-foreground/75">
            {impact.summary}
          </p>
        </div>
      )}

      {materialRows.length === 0 ? (
        <p className="mt-3 text-[12px] text-text-muted">{t('research.noMaterialChanges')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5" data-testid="change-rows">
          {diff.changes.map((change, index) => (
            <ChangeRow key={`${change.category}-${change.label}-${index}`} change={change} index={index} />
          ))}
        </div>
      )}
    </section>
  );
};

const ChangeRow: React.FC<{ change: ResearchChange; index: number }> = ({ change, index }) => {
  const { t } = useTranslation();
  const meta = DIRECTION_META[change.direction];
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
      data-testid={`change-row-${index}`}
    >
      <span className="rounded-[4px] bg-foreground/5 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-text-muted">
        {t(`research.category.${change.category}`)}
      </span>
      <span className="text-[12px] font-medium text-foreground">{change.label}</span>
      <span className="tnum text-[11.5px] text-text-muted">{formatValue(change.before)}</span>
      {change.before !== undefined && change.after !== undefined && (
        <span className="text-[11px] text-text-muted">→</span>
      )}
      <span className="tnum text-[11.5px] text-text-muted">{formatValue(change.after)}</span>
      <span className={`text-[11.5px] font-semibold ${meta.tone}`}>
        {meta.arrow} {t(`research.direction.${change.direction}`)}
      </span>
      {change.material && (
        <span className="rounded-[4px] bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent">
          {t('research.material')}
        </span>
      )}
    </div>
  );
};

function formatValue(value: string | number | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  return value;
}

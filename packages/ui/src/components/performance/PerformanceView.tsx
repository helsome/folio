import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import { MIN_EVALUATED_SAMPLES, type PerformanceHorizon } from '@finagent/core';
import {
  performanceAtom,
  performanceHorizonAtom,
  refreshPerformanceAtom,
} from '../../atoms/performanceAtoms';
import { CalibrationCard, type CalibrationRowView } from './CalibrationCard';
import { PerformanceCard, type PerformanceRowView } from './PerformanceCard';

/**
 * Performance (spec §36–42) — skill and strategy track records aggregated
 * from evaluated research opinions, tabbed by horizon (1w / 1m / 3m), plus
 * the Advanced calibration section: how each track record would adjust a
 * skill's weight, bounded and INFORMATIONAL ONLY (runtime weighting stays
 * future work, spec §42).
 *
 * Mounted as the 'Performance' tab in Settings (SettingsView). Aggregations
 * arrive over IPC from the main-process PerformanceService; while a channel
 * is unwired the loaders return [] and the cards show their empty states.
 */

const HORIZONS: PerformanceHorizon[] = ['1w', '1m', '3m'];

const HORIZON_LABEL: Record<PerformanceHorizon, string> = {
  '1w': 'performance.horizon1W',
  '1m': 'performance.horizon1M',
  '3m': 'performance.horizon3M',
};

/** Renderer-facing mirror of the research strategy preset names (StrategyPicker). */
const STRATEGY_NAMES: Readonly<Record<string, string>> = {
  comprehensive: 'performance.strategies.comprehensive',
  value: 'performance.strategies.value',
  growth: 'performance.strategies.growth',
  technical: 'performance.strategies.technical',
  earnings: 'performance.strategies.earnings',
  'event-driven': 'performance.strategies.event-driven',
  'risk-review': 'performance.strategies.risk-review',
  income: 'performance.strategies.income',
};

/** 'longbridge-value-investing' → 'Longbridge Value Investing' (display only). */
function skillLabel(skillId: string): string {
  return skillId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const PerformanceView: React.FC = () => {
  const { t } = useTranslation();
  const [state] = useAtom(performanceAtom);
  const [horizon, setHorizon] = useAtom(performanceHorizonAtom);
  const refresh = useSetAtom(refreshPerformanceAtom);

  useEffect(() => {
    void refresh(horizon);
  }, [refresh, horizon]);

  const skillRows: PerformanceRowView[] = state.skills.map((s) => ({
    id: s.skillId,
    label: skillLabel(s.skillId),
    samples: s.samples,
    hitRate: s.directionHitRate,
    metric: s.avgReturn,
    unableRate: s.unableRate,
    insufficientData: s.insufficientData,
  }));

  const strategyRows: PerformanceRowView[] = state.strategies.map((s) => ({
    id: s.strategyId,
    label: t(STRATEGY_NAMES[s.strategyId] ?? s.strategyId),
    samples: s.samples,
    hitRate: s.hitRate,
    metric: s.medianExcessReturn,
    insufficientData: s.insufficientData,
  }));

  const calibrationRows: CalibrationRowView[] = state.calibrations.map((c) => ({
    id: c.skillId,
    label: skillLabel(c.skillId),
    baseWeight: c.baseWeight,
    historicalAdjustment:
      c.finalBoundedWeight === null ? undefined : c.finalBoundedWeight - c.baseWeight,
    finalWeight: c.finalBoundedWeight ?? undefined,
    samples: c.samples,
    insufficientData: c.insufficientData,
  }));

  const strategyCalibrationRows: CalibrationRowView[] = state.strategyCalibrations.map((c) => ({
    id: c.strategyId,
    label: t(STRATEGY_NAMES[c.strategyId] ?? c.strategyId),
    baseWeight: c.baseWeight,
    historicalAdjustment:
      c.finalBoundedWeight === null ? undefined : c.finalBoundedWeight - c.baseWeight,
    finalWeight: c.finalBoundedWeight ?? undefined,
    samples: c.samples,
    insufficientData: c.insufficientData,
  }));

  return (
    <div className="max-w-3xl" data-testid="performance-view">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">{t('performance.title')}</h2>
        <div className="flex gap-1" data-testid="performance-horizons">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-smooth ${
                horizon === h
                  ? 'bg-foreground/8 text-foreground'
                  : 'text-foreground/52 hover:text-foreground'
              }`}
            >
              {t(HORIZON_LABEL[h])}
            </button>
          ))}
        </div>
      </header>
      <p className="mt-1 text-[12px] text-text-muted">
        {t('performance.intro', { min: MIN_EVALUATED_SAMPLES })}
      </p>
      {state.loading && <p className="mt-2 text-[11px] text-text-muted">{t('performance.loading')}</p>}
      <div className="mt-4 flex flex-col gap-4">
        <PerformanceCard
          title={t('performance.skillPerformance')}
          metricLabel={t('performance.avgReturn')}
          rows={skillRows}
          emptyMessage={t('performance.noSkillOutcomes')}
        />
        <PerformanceCard
          title={t('performance.strategyPerformance')}
          metricLabel={t('performance.medianExcessReturn')}
          rows={strategyRows}
          emptyMessage={t('performance.noStrategyOutcomes')}
        />
      </div>
      <div className="mt-6 border-t mac-section-divider pt-4" data-testid="calibration-area">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/44">
          {t('performance.calibrationAdvanced')}
        </h3>
        <p className="mt-1 text-[11px] text-text-muted">
          {t('performance.calibrationIntro')}
        </p>
        <div className="mt-3 flex flex-col gap-4">
          <CalibrationCard
            title={t('performance.skillCalibration')}
            rows={calibrationRows}
            emptyMessage={t('performance.noCalibratedSkillOutcomes')}
          />
          <CalibrationCard
            title={t('performance.strategyCalibration')}
            rows={strategyCalibrationRows}
            emptyMessage={t('performance.noCalibratedStrategyOutcomes')}
          />
        </div>
      </div>
    </div>
  );
};

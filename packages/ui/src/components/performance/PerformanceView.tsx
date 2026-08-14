import React, { useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { MIN_EVALUATED_SAMPLES, type PerformanceHorizon } from '@finagent/core';
import {
  performanceAtom,
  performanceHorizonAtom,
  refreshPerformanceAtom,
} from '../../atoms/performanceAtoms';
import { PerformanceCard, type PerformanceRowView } from './PerformanceCard';

/**
 * Performance (spec §36–38) — skill and strategy track records aggregated
 * from evaluated research opinions, tabbed by horizon (1w / 1m / 3m).
 *
 * Mounted as the 'Performance' tab in Settings (SettingsView). Aggregations
 * arrive over IPC from the main-process PerformanceService; while the channel
 * is unwired the loaders return [] and the cards show their empty states.
 */

const HORIZONS: PerformanceHorizon[] = ['1w', '1m', '3m'];

const HORIZON_LABEL: Record<PerformanceHorizon, string> = {
  '1w': '1 Week',
  '1m': '1 Month',
  '3m': '3 Months',
};

/** Renderer-facing mirror of the research strategy preset names (StrategyPicker). */
const STRATEGY_NAMES: Readonly<Record<string, string>> = {
  comprehensive: 'Comprehensive',
  value: 'Value',
  growth: 'Growth',
  technical: 'Technical',
  earnings: 'Earnings',
  'event-driven': 'Event-Driven',
  'risk-review': 'Risk Review',
  income: 'Income',
};

/** 'longbridge-value-investing' → 'Longbridge Value Investing' (display only). */
function skillLabel(skillId: string): string {
  return skillId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const PerformanceView: React.FC = () => {
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
    label: STRATEGY_NAMES[s.strategyId] ?? s.strategyId,
    samples: s.samples,
    hitRate: s.hitRate,
    metric: s.medianExcessReturn,
    insufficientData: s.insufficientData,
  }));

  return (
    <div className="max-w-3xl" data-testid="performance-view">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">Performance</h2>
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
              {HORIZON_LABEL[h]}
            </button>
          ))}
        </div>
      </header>
      <p className="mt-1 text-[12px] text-text-muted">
        Track record of evaluated research opinions. Groups below {MIN_EVALUATED_SAMPLES} samples are
        Observational Only — never tuned on a handful of outcomes.
      </p>
      {state.loading && <p className="mt-2 text-[11px] text-text-muted">Loading…</p>}
      <div className="mt-4 flex flex-col gap-4">
        <PerformanceCard
          title="Skill Performance"
          metricLabel="Avg Return"
          rows={skillRows}
          emptyMessage="No evaluated skill outcomes yet."
        />
        <PerformanceCard
          title="Strategy Performance"
          metricLabel="Median Excess Return"
          rows={strategyRows}
          emptyMessage="No evaluated strategy outcomes yet."
        />
      </div>
    </div>
  );
};

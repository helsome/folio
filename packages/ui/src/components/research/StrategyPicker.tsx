import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StrategyId } from '@finagent/core';

/**
 * Renderer-facing mirror of the V5 research strategy presets
 * (packages/shared/src/strategies/presets.ts). Kept local, like the other
 * renderer mirrors, so the UI never imports @finagent/shared (node/executor
 * code). Ids are validated main-side — the research:start handler rejects
 * unknown strategy ids, and the service throws RESEARCH_STRATEGY_INVALID.
 * Names/descriptions are localized; ids and focus chips stay ASCII (§11).
 */
const STRATEGY_PRESETS: ReadonlyArray<{
  id: StrategyId;
  /** camelCase `key` used to build the i18n resource keys. */
  key: string;
  focus: string[];
}> = [
  {
    id: 'comprehensive',
    key: 'comprehensive',
    focus: ['full plan', 'market', 'company', 'research'],
  },
  {
    id: 'value',
    key: 'value',
    focus: ['valuation', 'financials', 'dividends', 'profile'],
  },
  {
    id: 'growth',
    key: 'growth',
    focus: ['earnings growth', 'consensus', 'valuation'],
  },
  {
    id: 'technical',
    key: 'technical',
    focus: ['price action', 'trend', 'depth', 'trades'],
  },
  {
    id: 'earnings',
    key: 'earnings',
    focus: ['EPS forecasts', 'calendar', 'news'],
  },
  {
    id: 'event-driven',
    key: 'eventDriven',
    focus: ['news', 'catalysts', 'ratings', 'dividends'],
  },
  {
    id: 'risk-review',
    key: 'riskReview',
    focus: ['financials', 'news', 'ratings', 'trend'],
  },
  {
    id: 'income',
    key: 'income',
    focus: ['dividends', 'yield', 'payout', 'profile'],
  },
];

export const DEFAULT_STRATEGY_ID: StrategyId = 'comprehensive';

export interface StrategyPickerProps {
  value: StrategyId;
  onChange: (id: StrategyId) => void;
}

/** Preset card strip for the Deep Research start flow. */
export const StrategyPicker: React.FC<StrategyPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-3" data-testid="strategy-picker">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
        {t('research.researchStrategy')}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STRATEGY_PRESETS.map((preset) => {
          const selected = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={`strategy-card-${preset.id}`}
              aria-pressed={selected}
              onClick={() => onChange(preset.id)}
              className={`min-w-[190px] max-w-[220px] shrink-0 rounded-[10px] border p-2.5 text-left transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${
                selected ? 'border-accent bg-accent/10' : 'mac-list-row'
              }`}
            >
              <span className="block text-[12px] font-semibold text-foreground">
                {t(`research.strategies.${preset.key}Name`)}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-text-muted">
                {t(`research.strategies.${preset.key}Description`)}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {preset.focus.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-[5px] bg-foreground/8 px-1.5 py-0.5 text-[9.5px] font-medium text-text-muted"
                  >
                    {chip}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

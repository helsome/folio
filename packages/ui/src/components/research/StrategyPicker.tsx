import React from 'react';
import type { StrategyId } from '@finagent/core';

/**
 * Renderer-facing mirror of the V5 research strategy presets
 * (packages/shared/src/strategies/presets.ts). Kept local, like the other
 * renderer mirrors, so the UI never imports @finagent/shared (node/executor
 * code). Ids are validated main-side — the research:start handler rejects
 * unknown strategy ids, and the service throws RESEARCH_STRATEGY_INVALID.
 */
const STRATEGY_PRESETS: ReadonlyArray<{
  id: StrategyId;
  name: string;
  description: string;
  focus: string[];
}> = [
  {
    id: 'comprehensive',
    name: 'Comprehensive',
    description: 'Full-spectrum deep dive across market, company and research data.',
    focus: ['full plan', 'market', 'company', 'research'],
  },
  {
    id: 'value',
    name: 'Value',
    description: 'Fundamental value analysis — valuation multiples, financials and dividend history.',
    focus: ['valuation', 'financials', 'dividends', 'profile'],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'Growth focus — revenue/EPS trajectory, consensus estimates and valuation.',
    focus: ['earnings growth', 'consensus', 'valuation'],
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Technical analysis — price trend, intraday action, order flow and market temperature.',
    focus: ['price action', 'trend', 'depth', 'trades'],
  },
  {
    id: 'earnings',
    name: 'Earnings',
    description: 'Earnings intelligence — EPS forecasts, calendar catalysts and news.',
    focus: ['EPS forecasts', 'calendar', 'news'],
  },
  {
    id: 'event-driven',
    name: 'Event-Driven',
    description: 'Event-driven scan — news, calendar, ratings changes and dividend actions.',
    focus: ['news', 'catalysts', 'ratings', 'dividends'],
  },
  {
    id: 'risk-review',
    name: 'Risk Review',
    description: 'Risk review — financial red flags, news, ratings and trend health.',
    focus: ['financials', 'news', 'ratings', 'trend'],
  },
  {
    id: 'income',
    name: 'Income',
    description: 'Income focus — dividend history, payout capacity and financial stability.',
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
  return (
    <div className="mb-3" data-testid="strategy-picker">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
        Research strategy
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
              <span className="block text-[12px] font-semibold text-foreground">{preset.name}</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-text-muted">
                {preset.description}
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

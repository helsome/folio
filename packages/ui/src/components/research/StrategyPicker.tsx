import React from 'react';
import { useTranslation } from 'react-i18next';
import * as RadioGroup from '@radix-ui/react-radio-group';
import type { StrategyId } from '@finagent/core';

/**
 * Renderer-facing mirror of the V5 research strategy presets
 * (packages/shared/src/strategies/presets.ts). Kept local, like the other
 * renderer mirrors, so the UI never imports @finagent/shared (node/executor
 * code). Ids are validated main-side — the research:start handler rejects
 * unknown strategy ids, and the service throws RESEARCH_STRATEGY_INVALID.
 *
 * Strategy ids stay ASCII; names/descriptions/focus chips are localised
 * (V8 §31–33, §51–52). `focus` holds i18n keys into `research.focus.*`.
 */
const STRATEGY_PRESETS: ReadonlyArray<{
  id: StrategyId;
  /** camelCase `key` used to build the i18n resource keys. */
  key: string;
  /** i18n keys into `research.focus.<key>` for the focus chips. */
  focus: string[];
}> = [
  {
    id: 'comprehensive',
    key: 'comprehensive',
    focus: ['fullPlan', 'market', 'company', 'research'],
  },
  {
    id: 'value',
    key: 'value',
    focus: ['valuation', 'financials', 'dividends', 'profile'],
  },
  {
    id: 'growth',
    key: 'growth',
    focus: ['earningsGrowth', 'consensus', 'valuation'],
  },
  {
    id: 'technical',
    key: 'technical',
    focus: ['priceAction', 'trend', 'depth', 'trades'],
  },
  {
    id: 'earnings',
    key: 'earnings',
    focus: ['epsForecasts', 'calendar', 'news'],
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
  /** Strategy id recommended by the entry context (e.g. a Discover task). */
  recommendedId?: StrategyId | null;
}

/**
 * Single-column full-width vertical strategy list for the Deep Research start
 * flow. Each row is an accessible radio item (Radix RadioGroup): fully
 * keyboard-selectable (arrows + selection) with correct `aria-checked`.
 */
export const StrategyPicker: React.FC<StrategyPickerProps> = ({ value, onChange, recommendedId }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-3" data-testid="strategy-picker">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
        {t('research.researchStrategy')}
      </div>
      <RadioGroup.Root
        value={value}
        onValueChange={(next) => onChange(next as StrategyId)}
        className="flex w-full flex-col gap-1.5"
        aria-label={t('research.researchStrategy')}
      >
        {STRATEGY_PRESETS.map((preset) => {
          const selected = preset.id === value;
          const recommended = recommendedId === preset.id;
          return (
            <RadioGroup.Item
              key={preset.id}
              value={preset.id}
              data-testid={`strategy-card-${preset.id}`}
              className={`flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 cursor-pointer ${
                selected ? 'border-accent bg-accent/5' : 'border-transparent mac-list-row'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-smooth ${
                  selected ? 'border-accent' : 'border-text-muted/40'
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block text-[12px] font-semibold text-foreground">
                    {t(`research.strategies.${preset.key}Name`)}
                  </span>
                  {recommended && (
                    <span
                      data-testid={`strategy-recommended-${preset.id}`}
                      className="rounded-[4px] bg-accent/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent"
                    >
                      {t('research.recommended')}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-snug text-text-muted">
                  {t(`research.strategies.${preset.key}Description`)}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {preset.focus.map((chipKey) => (
                    <span
                      key={chipKey}
                      className="rounded-[5px] bg-foreground/8 px-1.5 py-0.5 text-[9.5px] font-medium text-text-muted"
                    >
                      {t(`research.focus.${chipKey}`)}
                    </span>
                  ))}
                </span>
              </span>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
    </div>
  );
};

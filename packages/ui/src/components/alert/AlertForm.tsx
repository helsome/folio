import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AlertRuleType } from '@finagent/core';
import { ALERT_RULE_TYPES } from '@finagent/core';
import type { AlertRuleDraft } from '../../atoms';
import { ALERT_TYPE_ICONS, ALERT_TYPE_KEYS } from './AlertCard';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';

interface AlertFormProps {
  symbol?: string;
  onSubmit: (draft: AlertRuleDraft) => void;
  onCancel: () => void;
}

const SYMBOL_REGEX = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

export const AlertForm: React.FC<AlertFormProps> = ({
  symbol: initialSymbol = '',
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [type, setType] = useState<AlertRuleType>('price_above');
  const [targetPrice, setTargetPrice] = useState('');
  const [horizonDays, setHorizonDays] = useState('14');
  const [minWeight, setMinWeight] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [threshold, setThreshold] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsSymbol = type !== 'portfolio_drawdown';

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (needsSymbol) {
      if (!symbol.trim()) {
        next.symbol = t('alerts.form.symbolRequired');
      } else if (!SYMBOL_REGEX.test(symbol)) {
        next.symbol = t('alerts.form.symbolInvalid');
      }
    }

    if (type === 'price_above' || type === 'price_below') {
      const value = parseFloat(targetPrice);
      if (!targetPrice.trim() || isNaN(value) || value <= 0) {
        next.targetPrice = t('alerts.form.targetPricePositive');
      }
    }

    if (type === 'earnings') {
      const value = parseInt(horizonDays, 10);
      if (isNaN(value) || value <= 0) {
        next.horizonDays = t('alerts.form.horizonDaysPositive');
      }
    }

    if (type === 'position_weight') {
      const min = minWeight.trim() === '' ? undefined : parseFloat(minWeight);
      const max = maxWeight.trim() === '' ? undefined : parseFloat(maxWeight);
      if (min === undefined && max === undefined) {
        next.minWeight = t('alerts.form.weightMinMax');
      } else {
        if (min !== undefined && (isNaN(min) || min < 0 || min > 100)) {
          next.minWeight = t('alerts.form.weightRange');
        }
        if (max !== undefined && (isNaN(max) || max < 0 || max > 100)) {
          next.maxWeight = t('alerts.form.weightRange');
        }
        if (min !== undefined && max !== undefined && min > max) {
          next.maxWeight = t('alerts.form.weightOrder');
        }
      }
    }

    if (type === 'portfolio_drawdown') {
      const value = parseFloat(threshold);
      if (!threshold.trim() || isNaN(value) || value <= 0 || value > 100) {
        next.threshold = t('alerts.form.drawdownRange');
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const draft: AlertRuleDraft = { type };
    if (needsSymbol) draft.symbol = symbol.trim();
    if (type === 'price_above' || type === 'price_below') {
      draft.targetPrice = parseFloat(targetPrice);
    }
    if (type === 'earnings') {
      draft.horizonDays = parseInt(horizonDays, 10);
    }
    if (type === 'position_weight') {
      if (minWeight.trim() !== '') draft.minWeight = parseFloat(minWeight) / 100;
      if (maxWeight.trim() !== '') draft.maxWeight = parseFloat(maxWeight) / 100;
    }
    if (type === 'portfolio_drawdown') {
      draft.threshold = parseFloat(threshold) / 100;
    }
    onSubmit(draft);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="border-b border-border pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-accent">
          {t('alerts.new')}
        </div>
        <div className="mt-1 text-[18px] font-semibold tracking-[-.02em] text-foreground">
          {t('alerts.createAlert')}
        </div>
      </div>

      {needsSymbol && (
        <Input
          label={t('alerts.form.symbol')}
          value={symbol}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value.toUpperCase())}
          placeholder="AAPL.US"
          error={errors.symbol}
        />
      )}

      <div className="space-y-2">
        <label className="text-[12px] font-medium text-foreground/70">
          {t('alerts.form.alertType')}
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          {ALERT_RULE_TYPES.map((tType) => (
            <button
              key={tType}
              type="button"
              onClick={() => setType(tType)}
              className={`flex min-h-10 items-center gap-2 rounded-[8px] border px-2.5 py-2 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                type === tType
                  ? 'border-accent bg-accent/10 font-medium text-foreground'
                  : 'border-border bg-surface text-foreground/58 hover:border-accent/45 hover:text-foreground'
              }`}
            >
              {React.createElement(ALERT_TYPE_ICONS[tType], { className: 'h-3.5 w-3.5 shrink-0 text-accent', 'aria-hidden': true })}
              {t(ALERT_TYPE_KEYS[tType])}
            </button>
          ))}
        </div>
      </div>

      {(type === 'price_above' || type === 'price_below') && (
        <Input
          label={t('alerts.form.targetPrice')}
          type="number"
          step="0.01"
          value={targetPrice}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTargetPrice(e.target.value)}
          placeholder="150.00"
          error={errors.targetPrice}
        />
      )}

      {type === 'earnings' && (
        <Input
          label={t('alerts.form.horizonDays')}
          type="number"
          step="1"
          value={horizonDays}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHorizonDays(e.target.value)}
          placeholder="14"
          error={errors.horizonDays}
        />
      )}

      {type === 'position_weight' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            label={t('alerts.form.minWeight')}
            type="number"
            step="0.1"
            value={minWeight}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinWeight(e.target.value)}
            placeholder="10"
            error={errors.minWeight}
          />
          <Input
            label={t('alerts.form.maxWeight')}
            type="number"
            step="0.1"
            value={maxWeight}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxWeight(e.target.value)}
            placeholder="30"
            error={errors.maxWeight}
          />
        </div>
      )}

      {type === 'portfolio_drawdown' && (
        <Input
          label={t('alerts.form.drawdownThreshold')}
          type="number"
          step="0.1"
          value={threshold}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThreshold(e.target.value)}
          placeholder="10"
          error={errors.threshold}
        />
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row">
        <Button type="button" variant="outline" onClick={onCancel} className="sm:min-w-24">
          {t('common.cancel')}
        </Button>
        <Button type="submit" className="flex-1">
          {t('alerts.form.create')}
        </Button>
      </div>
    </form>
  );
};

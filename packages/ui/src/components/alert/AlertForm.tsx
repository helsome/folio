import React, { useState } from 'react';
import type { AlertRuleType } from '@finagent/core';
import { ALERT_RULE_TYPES } from '@finagent/core';
import { ALERT_TYPE_LABELS, type AlertRuleDraft } from '../../atoms';
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
        next.symbol = 'Symbol is required';
      } else if (!SYMBOL_REGEX.test(symbol)) {
        next.symbol = 'Invalid format. Use: AAPL.US, 0700.HK';
      }
    }

    if (type === 'price_above' || type === 'price_below') {
      const value = parseFloat(targetPrice);
      if (!targetPrice.trim() || isNaN(value) || value <= 0) {
        next.targetPrice = 'Enter a positive target price';
      }
    }

    if (type === 'earnings') {
      const value = parseInt(horizonDays, 10);
      if (isNaN(value) || value <= 0) {
        next.horizonDays = 'Enter a positive number of days';
      }
    }

    if (type === 'position_weight') {
      const min = minWeight.trim() === '' ? undefined : parseFloat(minWeight);
      const max = maxWeight.trim() === '' ? undefined : parseFloat(maxWeight);
      if (min === undefined && max === undefined) {
        next.minWeight = 'Enter a min or max weight';
      } else {
        if (min !== undefined && (isNaN(min) || min < 0 || min > 100)) {
          next.minWeight = 'Weight must be 0–100%';
        }
        if (max !== undefined && (isNaN(max) || max < 0 || max > 100)) {
          next.maxWeight = 'Weight must be 0–100%';
        }
        if (min !== undefined && max !== undefined && min > max) {
          next.maxWeight = 'Max must be ≥ min';
        }
      }
    }

    if (type === 'portfolio_drawdown') {
      const value = parseFloat(threshold);
      if (!threshold.trim() || isNaN(value) || value <= 0 || value > 100) {
        next.threshold = 'Drawdown must be 0–100%';
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-lg font-semibold text-[oklch(var(--text-primary))]">Create Alert</div>

      {needsSymbol && (
        <Input
          label="Symbol"
          value={symbol}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value.toUpperCase())}
          placeholder="AAPL.US"
          error={errors.symbol}
        />
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-[oklch(var(--text-secondary))]">Alert Type</label>
        <div className="grid grid-cols-2 gap-2">
          {ALERT_RULE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`p-2 rounded-lg border text-sm transition-all ${
                type === t
                  ? 'border-[oklch(var(--accent-primary))] bg-[oklch(var(--accent-primary))]/10 text-[oklch(var(--text-primary))]'
                  : 'border-[oklch(var(--bg-primary))] text-[oklch(var(--text-secondary))] hover:border-[oklch(var(--accent-primary))]/50'
              }`}
            >
              {ALERT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {(type === 'price_above' || type === 'price_below') && (
        <Input
          label="Target Price"
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
          label="Horizon (days)"
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
            label="Min Weight %"
            type="number"
            step="0.1"
            value={minWeight}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinWeight(e.target.value)}
            placeholder="10"
            error={errors.minWeight}
          />
          <Input
            label="Max Weight %"
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
          label="Drawdown Threshold %"
          type="number"
          step="0.1"
          value={threshold}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThreshold(e.target.value)}
          placeholder="10"
          error={errors.threshold}
        />
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1">
          Create Alert
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

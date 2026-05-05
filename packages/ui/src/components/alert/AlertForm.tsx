import React, { useState } from 'react';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import type { Alert, AlertType } from '@finagent/core';

interface AlertFormProps {
  symbol?: string;
  onSubmit: (alert: Omit<Alert, 'id' | 'createdAt' | 'triggered'>) => void;
  onCancel: () => void;
}

const ALERT_TYPES: { value: AlertType; label: string }[] = [
  { value: 'price_above', label: 'Price Above' },
  { value: 'price_below', label: 'Price Below' },
  { value: 'news', label: 'News Alert' },
  { value: 'rating_change', label: 'Rating Change' },
];

export const AlertForm: React.FC<AlertFormProps> = ({
  symbol: initialSymbol = '',
  onSubmit,
  onCancel,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [type, setType] = useState<AlertType>('price_above');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<{ symbol?: string; value?: string }>({});

  const validate = (): boolean => {
    const newErrors: { symbol?: string; value?: string } = {};

    // Symbol validation
    if (!symbol.trim()) {
      newErrors.symbol = 'Symbol is required';
    } else if (!/^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/.test(symbol)) {
      newErrors.symbol = 'Invalid format. Use: AAPL.US, 0700.HK';
    }

    // Value validation
    if (!value.trim()) {
      newErrors.value = 'Value is required';
    } else if (isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
      newErrors.value = 'Value must be a positive number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    onSubmit({
      symbol: symbol.trim(),
      type,
      value: parseFloat(value),
      enabled: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-lg font-semibold text-[oklch(var(--text-primary))]">
        Create Alert
      </div>

      <Input
        label="Symbol"
        value={symbol}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value.toUpperCase())}
        placeholder="AAPL.US"
        error={errors.symbol}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-[oklch(var(--text-secondary))]">
          Alert Type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {ALERT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`p-2 rounded-lg border text-sm transition-all ${
                type === t.value
                  ? 'border-[oklch(var(--accent-primary))] bg-[oklch(var(--accent-primary))]/10 text-[oklch(var(--text-primary))]'
                  : 'border-[oklch(var(--bg-primary))] text-[oklch(var(--text-secondary))] hover:border-[oklch(var(--accent-primary))]/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Input
        label="Target Value"
        type="number"
        step="0.01"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        placeholder="150.00"
        error={errors.value}
      />

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
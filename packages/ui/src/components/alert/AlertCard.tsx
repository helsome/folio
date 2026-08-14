import React from 'react';
import type { AlertRule, AlertRuleType } from '@finagent/core';
import { ALERT_TYPE_LABELS, ruleSummary } from '../../atoms';

interface AlertCardProps {
  rule: AlertRule;
  onToggle?: () => void;
  onRemove?: () => void;
}

const ALERT_TYPE_ICONS: Record<AlertRuleType, string> = {
  price_above: '📈',
  price_below: '📉',
  new_news: '📰',
  earnings: '📅',
  rating_change: '⭐',
  dividend: '💰',
  position_weight: '⚖️',
  portfolio_drawdown: '🛡️',
};

export const AlertCard: React.FC<AlertCardProps> = ({ rule, onToggle, onRemove }) => {
  const displaySymbol = rule.type === 'portfolio_drawdown' ? 'Portfolio' : rule.symbol;

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        rule.enabled
          ? 'bg-[oklch(var(--bg-secondary))] border-[oklch(var(--bg-primary))]'
          : 'bg-[oklch(var(--bg-secondary))]/50 border-[oklch(var(--bg-primary))] opacity-60'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{ALERT_TYPE_ICONS[rule.type]}</span>
          <div>
            <div className="font-semibold text-[oklch(var(--text-primary))]">{displaySymbol}</div>
            <div className="text-sm text-[oklch(var(--text-secondary))]">
              {ALERT_TYPE_LABELS[rule.type]}: {ruleSummary(rule)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            aria-label={rule.enabled ? 'Disable alert' : 'Enable alert'}
            className={`w-10 h-5 rounded-full transition-colors ${
              rule.enabled ? 'bg-[oklch(var(--accent-primary))]' : 'bg-gray-600'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform ${
                rule.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button
            onClick={onRemove}
            aria-label="Remove alert"
            className="text-[oklch(var(--text-secondary))] hover:text-red-500 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-[oklch(var(--text-secondary))]">
        Created: {new Date(rule.createdAt).toLocaleDateString()}
        {rule.lastTriggeredAt && (
          <span className="ml-2">
            Last triggered: {new Date(rule.lastTriggeredAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};

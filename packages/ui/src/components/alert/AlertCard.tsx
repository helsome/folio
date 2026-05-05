import React from 'react';
import type { Alert } from '@finagent/core';

interface AlertCardProps {
  alert: Alert;
  onToggle?: () => void;
  onRemove?: () => void;
}

const ALERT_TYPE_LABELS: Record<Alert['type'], string> = {
  price_above: 'Price Above',
  price_below: 'Price Below',
  news: 'News Alert',
  rating_change: 'Rating Change',
};

const ALERT_TYPE_ICONS: Record<Alert['type'], string> = {
  price_above: '📈',
  price_below: '📉',
  news: '📰',
  rating_change: '⭐',
};

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onToggle, onRemove }) => {
  const isEnabled = alert.enabled && !alert.triggered;

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        alert.triggered
          ? 'bg-yellow-500/10 border-yellow-500/30'
          : isEnabled
          ? 'bg-[oklch(var(--bg-secondary))] border-[oklch(var(--bg-primary))]'
          : 'bg-[oklch(var(--bg-secondary))]/50 border-[oklch(var(--bg-primary))] opacity-60'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{ALERT_TYPE_ICONS[alert.type]}</span>
          <div>
            <div className="font-semibold text-[oklch(var(--text-primary))]">
              {alert.symbol}
            </div>
            <div className="text-sm text-[oklch(var(--text-secondary))]">
              {ALERT_TYPE_LABELS[alert.type]}: ${alert.value.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {alert.triggered && (
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-500 text-xs rounded-full">
              Triggered
            </span>
          )}
          <button
            onClick={onToggle}
            className={`w-10 h-5 rounded-full transition-colors ${
              isEnabled ? 'bg-[oklch(var(--accent-primary))]' : 'bg-gray-600'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button
            onClick={onRemove}
            className="text-[oklch(var(--text-secondary))] hover:text-red-500 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-[oklch(var(--text-secondary))]">
        Created: {new Date(alert.createdAt).toLocaleDateString()}
        {alert.triggeredAt && (
          <span className="ml-2">
            Triggered: {new Date(alert.triggeredAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};
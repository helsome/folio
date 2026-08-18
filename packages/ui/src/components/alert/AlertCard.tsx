import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AlertRule, AlertRuleType } from '@finagent/core';
import { formatCurrency } from '@finagent/i18n';

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

/** Alert type id → translation key (ids are never translated). */
export const ALERT_TYPE_KEYS: Record<AlertRuleType, string> = {
  price_above: 'alerts.type.priceAbove',
  price_below: 'alerts.type.priceBelow',
  new_news: 'alerts.type.news',
  earnings: 'alerts.type.earnings',
  rating_change: 'alerts.type.ratingChange',
  dividend: 'alerts.type.dividend',
  position_weight: 'alerts.type.positionWeight',
  portfolio_drawdown: 'alerts.type.drawdown',
};

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

/** Localized one-line rule summary (mirrors the atoms ruleSummary logic). */
function summary(rule: AlertRule, t: TFunc): string {
  switch (rule.type) {
    case 'price_above':
      return t('alerts.summary.above', { price: formatCurrency(rule.targetPrice) });
    case 'price_below':
      return t('alerts.summary.below', { price: formatCurrency(rule.targetPrice) });
    case 'new_news':
      return t('alerts.summary.newHeadlines');
    case 'earnings':
      return t('alerts.summary.earningsWithin', { count: rule.horizonDays });
    case 'rating_change':
      return t('alerts.summary.ratingChange');
    case 'dividend':
      return t('alerts.summary.exDividend');
    case 'position_weight': {
      const min = rule.minWeight !== undefined ? `${Math.round(rule.minWeight * 100)}%` : '0%';
      const max = rule.maxWeight !== undefined ? `${Math.round(rule.maxWeight * 100)}%` : '∞';
      return t('alerts.summary.weightOutside', { min, max });
    }
    case 'portfolio_drawdown':
      return t('alerts.summary.drawdown', {
        threshold: `${Math.round(rule.threshold * 100)}%`,
      });
  }
}

export const AlertCard: React.FC<AlertCardProps> = ({ rule, onToggle, onRemove }) => {
  const { t } = useTranslation();
  const displaySymbol = rule.type === 'portfolio_drawdown' ? t('portfolio.title') : rule.symbol;

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
              {t(ALERT_TYPE_KEYS[rule.type])}: {summary(rule, t)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            aria-label={rule.enabled ? t('alerts.disableAlert') : t('alerts.enableAlert')}
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
            aria-label={t('alerts.removeAlert')}
            className="text-[oklch(var(--text-secondary))] hover:text-red-500 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-[oklch(var(--text-secondary))]">
        {t('alerts.created', { date: new Date(rule.createdAt).toLocaleDateString() })}
        {rule.lastTriggeredAt && (
          <span className="ml-2">
            {t('alerts.lastTriggered', { date: new Date(rule.lastTriggeredAt).toLocaleString() })}
          </span>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AlertRule, AlertRuleType } from '@finagent/core';
import { formatCurrency } from '@finagent/i18n';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Coins,
  Newspaper,
  Scale,
  ShieldAlert,
  Star,
  type LucideIcon,
} from 'lucide-react';

interface AlertCardProps {
  rule: AlertRule;
  onToggle?: () => void;
  onRemove?: () => void;
}

export const ALERT_TYPE_ICONS: Record<AlertRuleType, LucideIcon> = {
  price_above: ArrowUpRight,
  price_below: ArrowDownRight,
  new_news: Newspaper,
  earnings: CalendarDays,
  rating_change: Star,
  dividend: Coins,
  position_weight: Scale,
  portfolio_drawdown: ShieldAlert,
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
  const Icon = ALERT_TYPE_ICONS[rule.type];

  return (
    <div
      className={`rounded-[10px] border bg-surface-raised p-3.5 transition-colors ${
        rule.enabled
          ? 'border-border'
          : 'border-border/70 bg-surface-muted/55'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent/10 text-accent">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="font-semibold text-foreground">{displaySymbol}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  rule.enabled ? 'bg-positive/10 text-positive' : 'bg-foreground/7 text-foreground/48'
                }`}
              >
                {rule.enabled ? t('alerts.status.active') : t('alerts.status.paused')}
              </span>
            </div>
            <div className="mt-1 text-[12px] text-foreground/58">
              <span className="font-medium text-foreground/72">{t(ALERT_TYPE_KEYS[rule.type])}</span>
              <span className="mx-1.5 text-foreground/28">·</span>
              {summary(rule, t)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onToggle}
            aria-label={rule.enabled ? t('alerts.disableAlert') : t('alerts.enableAlert')}
            className={`h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              rule.enabled ? 'bg-primary' : 'bg-foreground/15'
            }`}
          >
            <div
              className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button
            onClick={onRemove}
            aria-label={t('alerts.removeAlert')}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-lg leading-none text-foreground/35 transition-colors hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/70 pt-2.5 text-[11px] text-foreground/42">
        <span>{t('alerts.created', { date: new Date(rule.createdAt).toLocaleDateString() })}</span>
        {rule.lastTriggeredAt && (
          <span>
            {t('alerts.lastTriggered', { date: new Date(rule.lastTriggeredAt).toLocaleString() })}
          </span>
        )}
      </div>
    </div>
  );
};

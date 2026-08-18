import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PortfolioView } from '../../atoms/portfolioAtoms';
import { formatCurrency } from '@finagent/i18n';

interface AssetPieChartProps {
  view: PortfolioView;
}

const COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
];

interface Slice {
  name: string;
  value: number;
  currency?: string;
  color: string;
}

export const AssetPieChart: React.FC<AssetPieChartProps> = ({ view }) => {
  const { t } = useTranslation();
  const holdingsValue = view.holdings
    .map((h) => h.marketValueBase ?? h.marketValue ?? 0)
    .reduce((sum, v) => sum + (v > 0 ? v : 0), 0);
  const cash = view.cash ?? 0;
  const total = view.totalAssets ?? (holdingsValue + cash);

  const items: Slice[] = [
    { name: t('portfolio.cash'), value: cash, currency: view.baseCurrency, color: 'bg-gray-400' },
    ...view.holdings.map((h, i) => ({
      name: h.symbol,
      value: h.marketValueBase ?? h.marketValue ?? 0,
      currency: h.currency,
      color: COLORS[i % COLORS.length],
    })),
  ].filter((item) => item.value > 0);

  const maxItems = 8;
  const displayItems = items.slice(0, maxItems);
  const otherValue = items.slice(maxItems).reduce((sum, item) => sum + item.value, 0);

  if (total <= 0 || items.length === 0) {
    return (
      <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg text-center text-[oklch(var(--text-secondary))]">
        {t('portfolio.noHoldingsToDisplay')}
      </div>
    );
  }

  return (
    <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg">
      <h3 className="font-semibold text-[oklch(var(--text-primary))] mb-4">
        {t('portfolio.assetAllocation')}
      </h3>

      <div className="flex h-4 rounded-full overflow-hidden mb-4">
        {displayItems.map((item, i) => (
          <div
            key={i}
            className={`${item.color} transition-all`}
            style={{ width: `${(item.value / total) * 100}%` }}
            title={`${item.name}: ${formatCurrency(item.value, item.currency)} (${((item.value / total) * 100).toFixed(1)}%)`}
          />
        ))}
        {otherValue > 0 && (
          <div
            className="bg-gray-500"
            style={{ width: `${(otherValue / total) * 100}%` }}
            title={`${t('portfolio.other')}: ${formatCurrency(otherValue, view.baseCurrency)}`}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {displayItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={`w-3 h-3 rounded-sm ${item.color}`} />
            <span className="text-[oklch(var(--text-secondary))] truncate">
              {item.name}:
            </span>
            <span className="text-[oklch(var(--text-primary))] font-medium">
              {((item.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
        {otherValue > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-sm bg-gray-500" />
            <span className="text-[oklch(var(--text-secondary))]">{t('portfolio.other')}:</span>
            <span className="text-[oklch(var(--text-primary))] font-medium">
              {((otherValue / total) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

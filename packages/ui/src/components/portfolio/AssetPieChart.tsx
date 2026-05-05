import React from 'react';
import type { Portfolio } from '@finagent/core';

interface AssetPieChartProps {
  portfolio: Portfolio;
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

export const AssetPieChart: React.FC<AssetPieChartProps> = ({ portfolio }) => {
  const { positions, totalValue, cash } = portfolio;

  // Calculate percentages
  const totalStockValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const items = [
    { name: 'Cash', value: cash, color: 'bg-gray-400' },
    ...positions.map((p, i) => ({
      name: p.symbol,
      value: p.marketValue,
      color: COLORS[i % COLORS.length],
    })),
  ].filter(item => item.value > 0);

  const maxItems = 8;
  const displayItems = items.slice(0, maxItems);
  const otherValue = items.slice(maxItems).reduce((sum, item) => sum + item.value, 0);

  if (totalValue === 0) {
    return (
      <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg text-center text-[oklch(var(--text-secondary))]">
        No holdings to display
      </div>
    );
  }

  return (
    <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg">
      <h3 className="font-semibold text-[oklch(var(--text-primary))] mb-4">
        Asset Allocation
      </h3>

      {/* Simple bar representation */}
      <div className="flex h-4 rounded-full overflow-hidden mb-4">
        {displayItems.map((item, i) => (
          <div
            key={i}
            className={`${item.color} transition-all`}
            style={{ width: `${(item.value / totalValue) * 100}%` }}
            title={`${item.name}: $${item.value.toFixed(2)} (${((item.value / totalValue) * 100).toFixed(1)}%)`}
          />
        ))}
        {otherValue > 0 && (
          <div
            className="bg-gray-500"
            style={{ width: `${(otherValue / totalValue) * 100}%` }}
            title={`Other: $${otherValue.toFixed(2)}`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {displayItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={`w-3 h-3 rounded-sm ${item.color}`} />
            <span className="text-[oklch(var(--text-secondary))] truncate">
              {item.name}:
            </span>
            <span className="text-[oklch(var(--text-primary))] font-medium">
              {((item.value / totalValue) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
        {otherValue > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-sm bg-gray-500" />
            <span className="text-[oklch(var(--text-secondary))]">Other:</span>
            <span className="text-[oklch(var(--text-primary))] font-medium">
              {((otherValue / totalValue) * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
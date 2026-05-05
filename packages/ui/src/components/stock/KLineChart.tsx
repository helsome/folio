import React from 'react';
import type { Kline } from '@finagent/core';

interface KLineChartProps {
  data: Kline[];
  symbol: string;
  period?: string;
}

// Simple ASCII-style chart for terminal display
export const KLineChart: React.FC<KLineChartProps> = ({ data, symbol, period = '1d' }) => {
  if (!data || data.length === 0) {
    return (
      <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg text-center text-[oklch(var(--text-secondary))]">
        No data available
      </div>
    );
  }

  // Get last 20 candles for display
  const recentData = data.slice(-20);

  // Calculate min/max for scaling
  const prices = recentData.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // Scale height: 0-100 mapping
  const scaleHeight = (price: number) => {
    return Math.round(((price - minPrice) / priceRange) * 100);
  };

  // Simple bar chart representation
  const maxBars = 40;
  const step = Math.max(1, Math.floor(recentData.length / maxBars));
  const displayData = recentData.filter((_, i) => i % step === 0).slice(-maxBars);

  return (
    <div className="bg-[oklch(var(--bg-secondary))] rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-[oklch(var(--text-primary))]">
          {symbol} K-Line ({period})
        </h3>
        <span className="text-xs text-[oklch(var(--text-secondary))]">
          {data.length} candles
        </span>
      </div>

      {/* Price range info */}
      <div className="flex justify-between text-xs text-[oklch(var(--text-secondary))] mb-2">
        <span>High: ${maxPrice.toFixed(2)}</span>
        <span>Low: ${minPrice.toFixed(2)}</span>
      </div>

      {/* Simple bar chart */}
      <div className="flex items-end gap-0.5 h-32">
        {displayData.map((kline, i) => {
          const open = scaleHeight(kline.open);
          const close = scaleHeight(kline.close);
          const high = scaleHeight(kline.high);
          const low = scaleHeight(kline.low);

          const isGreen = kline.close >= kline.open;
          const color = isGreen ? 'bg-green-500' : 'bg-red-500';

          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-between relative group"
            >
              {/* High-Low wick */}
              <div
                className={`absolute w-px ${color} opacity-60 left-1/2 -translate-x-1/2`}
                style={{
                  top: `${100 - high}%`,
                  height: `${high - low}%`,
                }}
              />
              {/* Body */}
              <div
                className={`w-full ${color} rounded-sm relative`}
                style={{
                  height: `${Math.abs(close - open) || 2}%`,
                  top: `${100 - Math.max(open, close)}%`,
                }}
              />
              {/* Tooltip on hover */}
              <div className="absolute hidden group-hover:block bg-[oklch(var(--bg-primary))] text-[oklch(var(--text-primary))] text-xs p-2 rounded shadow-lg z-10 whitespace-nowrap">
                <div>O: ${kline.open.toFixed(2)}</div>
                <div>H: ${kline.high.toFixed(2)}</div>
                <div>L: ${kline.low.toFixed(2)}</div>
                <div>C: ${kline.close.toFixed(2)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Latest price */}
      <div className="mt-4 text-center">
        <span className="text-lg font-bold text-[oklch(var(--text-primary))]">
          ${recentData[recentData.length - 1]?.close.toFixed(2) || '-'}
        </span>
      </div>
    </div>
  );
};
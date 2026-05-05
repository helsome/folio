import React from 'react';
import type { Quote } from '@finagent/core';

interface StockCardProps {
  quote: Quote;
  onClick?: () => void;
}

export const StockCard: React.FC<StockCardProps> = ({ quote, onClick }) => {
  const isPositive = quote.change >= 0;
  const changeColor = isPositive ? 'text-green-500' : 'text-red-500';
  const bgColor = isPositive ? 'border-green-500/20' : 'border-red-500/20';

  return (
    <div
      className={`p-4 rounded-lg bg-[oklch(var(--bg-secondary))] border ${bgColor} cursor-pointer hover:opacity-80 transition-opacity`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold text-[oklch(var(--text-primary))]">{quote.symbol}</div>
          <div className="text-2xl font-bold text-[oklch(var(--text-primary))]">
            ${quote.lastPrice.toFixed(2)}
          </div>
        </div>
        <div className={`text-right ${changeColor}`}>
          <div className="font-medium">
            {isPositive ? '+' : ''}{quote.change.toFixed(2)}
          </div>
          <div className="text-sm">
            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-between text-xs text-[oklch(var(--text-secondary))]">
        <span>Vol: {quote.volume.toLocaleString()}</span>
        <span>H: ${quote.high.toFixed(2)} L: ${quote.low.toFixed(2)}</span>
      </div>
    </div>
  );
};
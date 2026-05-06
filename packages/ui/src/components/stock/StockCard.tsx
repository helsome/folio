import React from 'react';
import type { Quote } from '@finagent/core';

interface StockCardProps {
  quote: Quote;
  onClick?: () => void;
}

export const StockCard: React.FC<StockCardProps> = ({ quote, onClick }) => {
  const isPositive = quote.change >= 0;
  const changeColor = isPositive ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]';
  const bgColor = isPositive ? 'border-[rgba(48,209,88,0.22)]' : 'border-[rgba(255,69,58,0.22)]';

  return (
    <div
      className={`mac-stock-tile cursor-pointer rounded-[14px] border p-4 transition-smooth hover:translate-y-[-1px] ${bgColor}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[13px] font-semibold text-foreground/72">{quote.symbol}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            ${quote.lastPrice.toFixed(2)}
          </div>
        </div>
        <div className={`text-right ${changeColor}`}>
          <div className="font-semibold">
            {isPositive ? '+' : ''}{quote.change.toFixed(2)}
          </div>
          <div className="text-[13px]">
            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-between text-[12px] text-foreground/48">
        <span>Vol: {quote.volume.toLocaleString()}</span>
        <span>H: ${quote.high.toFixed(2)} L: ${quote.low.toFixed(2)}</span>
      </div>
    </div>
  );
};

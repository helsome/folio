import React from 'react';
import type { Position } from '@finagent/core';

interface HoldingRowProps {
  position: Position;
  onClick?: () => void;
}

export const HoldingRow: React.FC<HoldingRowProps> = ({ position, onClick }) => {
  const isPositive = position.unrealizedPnL >= 0;
  const pnlColor = isPositive ? 'text-green-500' : 'text-red-500';

  return (
    <div
      className="flex justify-between items-center p-3 bg-[oklch(var(--bg-secondary))] rounded-lg hover:opacity-80 cursor-pointer transition-opacity"
      onClick={onClick}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[oklch(var(--text-primary))]">
            {position.symbol}
          </span>
          <span className="text-sm text-[oklch(var(--text-secondary))]">
            {position.name}
          </span>
        </div>
        <div className="text-sm text-[oklch(var(--text-secondary))] mt-1">
          {position.quantity} shares @ ${position.avgCost.toFixed(2)}
        </div>
      </div>

      <div className="text-right">
        <div className="font-semibold text-[oklch(var(--text-primary))]">
          ${position.marketValue.toFixed(2)}
        </div>
        <div className={`text-sm ${pnlColor}`}>
          {isPositive ? '+' : ''}${position.unrealizedPnL.toFixed(2)}
          <span className="ml-1">({isPositive ? '+' : ''}{position.unrealizedPnLPercent.toFixed(2)}%)</span>
        </div>
      </div>

      <div className="ml-4 text-right">
        <div className="text-[oklch(var(--text-primary))]">
          ${position.lastPrice.toFixed(2)}
        </div>
        <div className="text-xs text-[oklch(var(--text-secondary))]">Last</div>
      </div>
    </div>
  );
};
import React from 'react';
import type { Holding } from '@finagent/core';
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../../lib/money';

interface HoldingRowProps {
  holding: Holding;
  onClick?: () => void;
}

export const HoldingRow: React.FC<HoldingRowProps> = ({ holding, onClick }) => {
  const pnl = holding.unrealizedPnL;
  const isPositive = (pnl ?? 0) >= 0;
  const pnlColor = isPositive ? 'text-green-500' : 'text-red-500';

  return (
    <div
      className="flex justify-between items-center p-3 bg-[oklch(var(--bg-secondary))] rounded-lg hover:opacity-80 cursor-pointer transition-opacity"
      onClick={onClick}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[oklch(var(--text-primary))]">
            {holding.symbol}
          </span>
          <span className="text-sm text-[oklch(var(--text-secondary))]">
            {holding.name}
          </span>
        </div>
        <div className="text-sm text-[oklch(var(--text-secondary))] mt-1">
          {formatQuantity(holding.quantity)} @ {formatMoney(holding.costPrice, holding.currency)}
        </div>
      </div>

      <div className="text-right">
        <div className="font-semibold text-[oklch(var(--text-primary))]">
          {formatMoney(holding.marketValue, holding.currency)}
        </div>
        <div className={`text-sm ${pnlColor}`}>
          {formatSignedMoney(holding.unrealizedPnL, holding.currency)}
          <span className="ml-1">({formatPercent(holding.unrealizedPnLPercent)})</span>
        </div>
      </div>

      <div className="ml-4 text-right">
        <div className="text-[oklch(var(--text-primary))]">
          {formatMoney(holding.marketPrice, holding.currency)}
        </div>
        <div className="text-xs text-[oklch(var(--text-secondary))]">Last</div>
      </div>
    </div>
  );
};

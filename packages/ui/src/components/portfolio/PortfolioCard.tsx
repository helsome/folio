import React from 'react';
import type { Portfolio } from '@finagent/core';

interface PortfolioCardProps {
  portfolio: Portfolio;
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({ portfolio }) => {
  const totalPnL = portfolio.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  const totalInvested = portfolio.positions.reduce((sum, p) => sum + p.avgCost * p.quantity, 0);
  const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const isPositive = totalPnL >= 0;
  const pnlColor = isPositive ? 'text-green-500' : 'text-red-500';

  return (
    <div className="p-4 bg-[oklch(var(--bg-secondary))] rounded-lg">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm text-[oklch(var(--text-secondary))]">Total Value</div>
          <div className="text-3xl font-bold text-[oklch(var(--text-primary))]">
            ${portfolio.totalValue.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${pnlColor}`}>
            {isPositive ? '+' : ''}${totalPnL.toFixed(2)}
          </div>
          <div className={`text-sm ${pnlColor}`}>
            {isPositive ? '+' : ''}{totalPnLPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-between text-sm">
        <div>
          <span className="text-[oklch(var(--text-secondary))]">Cash: </span>
          <span className="text-[oklch(var(--text-primary))] font-medium">
            ${portfolio.cash.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-[oklch(var(--text-secondary))]">Positions: </span>
          <span className="text-[oklch(var(--text-primary))] font-medium">
            {portfolio.positions.length}
          </span>
        </div>
      </div>
    </div>
  );
};
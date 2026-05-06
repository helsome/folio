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
  const pnlColor = isPositive ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]';

  return (
    <div className="mac-stock-tile rounded-[14px] p-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[13px] text-foreground/54">Total Value</div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
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
          <span className="text-foreground/54">Cash: </span>
          <span className="font-medium text-foreground">
            ${portfolio.cash.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-foreground/54">Positions: </span>
          <span className="font-medium text-foreground">
            {portfolio.positions.length}
          </span>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import type { PortfolioView } from '../../atoms/portfolioAtoms';
import { formatMoney, formatPercent, formatSignedMoney } from '../../lib/money';

interface PortfolioCardProps {
  view: PortfolioView;
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({ view }) => {
  const invested = view.totalAssets !== undefined && view.totalPnL !== undefined
    ? view.totalAssets - view.totalPnL
    : undefined;
  const pnlPercent = invested !== undefined && invested > 0
    ? (view.totalPnL ?? 0) / invested * 100
    : undefined;

  const totalPnL = view.totalPnL ?? 0;
  const isPositive = totalPnL >= 0;
  const pnlColor = isPositive ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]';

  return (
    <div className="mac-stock-tile rounded-[14px] p-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[13px] text-foreground/54">Total Value</div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            {formatMoney(view.totalAssets, view.baseCurrency)}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${pnlColor}`}>
            {formatSignedMoney(view.totalPnL, view.baseCurrency)}
          </div>
          <div className={`text-sm ${pnlColor}`}>{formatPercent(pnlPercent)}</div>
        </div>
      </div>

      <div className="mt-4 flex justify-between text-sm">
        <div>
          <span className="text-foreground/54">Cash: </span>
          <span className="font-medium text-foreground">
            {formatMoney(view.cash, view.baseCurrency)}
          </span>
        </div>
        <div>
          <span className="text-foreground/54">Today: </span>
          <span className={`font-medium ${pnlColor}`}>
            {formatSignedMoney(view.todayPnL, view.baseCurrency)}
          </span>
        </div>
        <div>
          <span className="text-foreground/54">Positions: </span>
          <span className="font-medium text-foreground">{view.holdings.length}</span>
        </div>
      </div>
    </div>
  );
};

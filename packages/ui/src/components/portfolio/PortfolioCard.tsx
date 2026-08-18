import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PortfolioView } from '../../atoms/portfolioAtoms';
import { formatCurrency, formatSignedCurrency, formatPercent } from '@finagent/i18n';

interface PortfolioCardProps {
  view: PortfolioView;
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({ view }) => {
  const { t } = useTranslation();
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
          <div className="text-[13px] text-foreground/54">{t('portfolio.totalValue')}</div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            {formatCurrency(view.totalAssets, view.baseCurrency)}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${pnlColor}`}>
            {formatSignedCurrency(view.totalPnL, view.baseCurrency)}
          </div>
          <div className={`text-sm ${pnlColor}`}>{formatPercent(pnlPercent)}</div>
        </div>
      </div>

      <div className="mt-4 flex justify-between text-sm">
        <div>
          <span className="text-foreground/54">{t('portfolio.cash')}: </span>
          <span className="font-medium text-foreground">
            {formatCurrency(view.cash, view.baseCurrency)}
          </span>
        </div>
        <div>
          <span className="text-foreground/54">{t('portfolio.today')}: </span>
          <span className={`font-medium ${pnlColor}`}>
            {formatSignedCurrency(view.todayPnL, view.baseCurrency)}
          </span>
        </div>
        <div>
          <span className="text-foreground/54">{t('portfolio.positions')}: </span>
          <span className="font-medium text-foreground">{view.holdings.length}</span>
        </div>
      </div>
    </div>
  );
};

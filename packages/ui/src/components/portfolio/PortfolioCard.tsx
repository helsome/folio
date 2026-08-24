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
    <div className="rounded-[16px] border border-[var(--mac-border)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/48">{t('portfolio.totalValue')}</div>
          <div className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.05em] tabular-nums text-foreground">
            {formatCurrency(view.totalAssets, view.baseCurrency)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className={`rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ${isPositive ? 'bg-[var(--mac-green)]/10' : 'bg-[var(--mac-red)]/10'} ${pnlColor}`}>
            {formatSignedCurrency(view.totalPnL, view.baseCurrency)}
          </div>
          <div className={`text-[12px] tabular-nums ${pnlColor}`}>{formatPercent(pnlPercent)}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--mac-border)] pt-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-foreground/54">{t('portfolio.cash')}: </span>
          <span className="text-[13px] font-medium tabular-nums text-foreground">
            {formatCurrency(view.cash, view.baseCurrency)}
          </span>
        </div>
        <div className="flex flex-col gap-1 sm:border-l sm:border-[var(--mac-border)] sm:pl-3">
          <span className="text-foreground/54">{t('portfolio.today')}: </span>
          <span className={`text-[13px] font-medium tabular-nums ${pnlColor}`}>
            {formatSignedCurrency(view.todayPnL, view.baseCurrency)}
          </span>
        </div>
        <div className="flex flex-col gap-1 sm:border-l sm:border-[var(--mac-border)] sm:pl-3">
          <span className="text-foreground/54">{t('portfolio.positions')}: </span>
          <span className="text-[13px] font-medium tabular-nums text-foreground">{view.holdings.length}</span>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { Holding } from '@finagent/core';
import {
  formatCurrency,
  formatSignedCurrency,
  formatPercent,
  formatNumber,
} from '@finagent/i18n';

interface HoldingRowProps {
  holding: Holding;
  onClick?: () => void;
  onResearch?: () => void;
}

export const HoldingRow: React.FC<HoldingRowProps> = ({ holding, onClick, onResearch }) => {
  const { t } = useTranslation();
  const pnl = holding.unrealizedPnL;
  const isPositive = (pnl ?? 0) >= 0;
  const pnlColor = isPositive ? 'text-green-500' : 'text-red-500';

  return (
    <div
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-[13px] border border-[var(--mac-border)] bg-white p-3.5 transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[var(--mac-blue)]/35 hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] active:translate-y-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
      onClick={onClick}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[13px] text-foreground">
            {holding.symbol}
          </span>
          <span className="truncate text-[11px] text-foreground/48">
            {holding.name}
          </span>
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-foreground/48">
          {formatNumber(holding.quantity, undefined, { maximumFractionDigits: 0 })} @{' '}
          {formatCurrency(holding.costPrice, holding.currency)}
        </div>
      </div>

      <div className="text-right">
        <div className="text-[13px] font-semibold tabular-nums text-foreground">
          {formatCurrency(holding.marketValue, holding.currency)}
        </div>
        <div className={`mt-1 text-[11px] tabular-nums ${pnlColor}`}>
          {formatSignedCurrency(holding.unrealizedPnL, holding.currency)}
          <span className="ml-1">({formatPercent(holding.unrealizedPnLPercent)})</span>
        </div>
      </div>

      <div className="hidden text-right sm:block">
        <div className="text-[12px] tabular-nums text-foreground">
          {formatCurrency(holding.marketPrice, holding.currency)}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-foreground/42">{t('portfolio.last')}</div>
      </div>

      {/* V9: the position's primary contextual action is Research (spec §51). */}
      {onResearch && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onResearch();
          }}
          data-testid={`holding-research-${holding.symbol}`}
          className="col-span-2 flex shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-[#0052ff] px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#0047d9] active:scale-[0.98] sm:col-span-1"
        >
          <Search className="h-3 w-3" strokeWidth={1.9} />
          {t('research.symbolEntry.startShort')}
        </button>
      )}
    </div>
  );
};

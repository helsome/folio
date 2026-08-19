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
          {formatNumber(holding.quantity, undefined, { maximumFractionDigits: 0 })} @{' '}
          {formatCurrency(holding.costPrice, holding.currency)}
        </div>
      </div>

      <div className="text-right">
        <div className="font-semibold text-[oklch(var(--text-primary))]">
          {formatCurrency(holding.marketValue, holding.currency)}
        </div>
        <div className={`text-sm ${pnlColor}`}>
          {formatSignedCurrency(holding.unrealizedPnL, holding.currency)}
          <span className="ml-1">({formatPercent(holding.unrealizedPnLPercent)})</span>
        </div>
      </div>

      <div className="ml-4 text-right">
        <div className="text-[oklch(var(--text-primary))]">
          {formatCurrency(holding.marketPrice, holding.currency)}
        </div>
        <div className="text-xs text-[oklch(var(--text-secondary))]">{t('portfolio.last')}</div>
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
          className="ml-3 flex shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground transition-smooth hover:bg-primary/88 active:scale-[0.98]"
        >
          <Search className="h-3 w-3" strokeWidth={1.9} />
          {t('research.symbolEntry.startShort')}
        </button>
      )}
    </div>
  );
};

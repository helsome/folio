import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Comparison } from '@finagent/core';

const DASH = '\u2014';

/** Stable metric-id → translation-key map (ids themselves are never translated). */
const METRIC_KEYS: Record<string, string> = {
  'Price': 'compare.metrics.price',
  'Market Cap': 'compare.metrics.marketCap',
  'PE': 'compare.metrics.pe',
  'PB': 'compare.metrics.pb',
  'Revenue Growth': 'compare.metrics.revenueGrowth',
  'Gross Margin': 'compare.metrics.grossMargin',
  'ROE': 'compare.metrics.roe',
  'Dividend Yield': 'compare.metrics.dividendYield',
  '1M Return': 'compare.metrics.return1m',
  '3M Return': 'compare.metrics.return3m',
  '1Y Return': 'compare.metrics.return1y',
  'Analyst Rating': 'compare.metrics.analystRating',
  'Momentum': 'compare.metrics.momentum',
};

/** Comparison table: one metric per row, one column per symbol. */
export const CompareTable: React.FC<{ comparison: Comparison }> = ({ comparison }) => {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border bg-surface-raised" data-testid="compare-table">
      <table className="min-w-[540px] w-full border-collapse text-[12px]">
        <thead className="bg-surface-muted/45">
          <tr className="border-b border-border">
            <th className="w-[40%] min-w-[150px] px-3.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t('compare.metric')}
            </th>
            {comparison.symbols.map((symbol) => (
              <th key={symbol} className="whitespace-nowrap px-3.5 py-2.5 text-right text-[11.5px] font-semibold tabular-nums text-[var(--mac-blue)]">
                {symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => {
            const key = METRIC_KEYS[row.metric];
            const label = key !== undefined ? t(key) : row.metric;
            return (
              <tr key={row.metric} className="border-b border-border/70 last:border-0 hover:bg-surface-hover transition-colors">
                <td className="whitespace-nowrap px-3.5 py-2.5 font-medium text-foreground/68">{label}</td>
                {comparison.symbols.map((symbol) => (
                  <td
                    key={symbol}
                    className={`whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums ${row.cells[symbol]?.missing ? 'text-text-muted' : 'font-medium text-foreground'}`}
                  >
                    {row.cells[symbol]?.display ?? DASH}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

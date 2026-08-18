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
    <div className="overflow-x-auto rounded-[10px] border border-foreground/8" data-testid="compare-table">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-foreground/8">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
              {t('compare.metric')}
            </th>
            {comparison.symbols.map((symbol) => (
              <th key={symbol} className="px-3 py-2 text-right tabular-nums text-foreground/70">
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
              <tr key={row.metric} className="border-b border-foreground/6 last:border-0">
                <td className="px-3 py-2 text-foreground/70">{label}</td>
                {comparison.symbols.map((symbol) => (
                  <td key={symbol} className="px-3 py-2 text-right tabular-nums text-foreground">
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

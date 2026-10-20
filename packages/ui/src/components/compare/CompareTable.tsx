import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Comparison } from '@finagent/core';
import { describeProvenance } from '../../lib/provenance';

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
  // The selected cell's source detail renders below the table: real provider,
  // as-of/retrieved times, and delayed/stale/failover state — unknown parts
  // say so instead of inheriting a table-wide badge (#332).
  const [selected, setSelected] = useState<{ metric: string; symbol: string } | null>(null);
  const selectedCell = selected
    ? comparison.rows.find((row) => row.metric === selected.metric)?.cells[selected.symbol]
    : undefined;
  return (
    <div>
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
                {comparison.symbols.map((symbol) => {
                  const cell = row.cells[symbol];
                  const isSelected = selected?.metric === row.metric && selected?.symbol === symbol;
                  return (
                    <td
                      key={symbol}
                      role="button"
                      tabIndex={0}
                      title={describeProvenance(cell?.provenance, t)}
                      aria-label={`${label} ${symbol} source detail`}
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSelected((current) =>
                          current?.metric === row.metric && current?.symbol === symbol
                            ? null
                            : { metric: row.metric, symbol }
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelected({ metric: row.metric, symbol });
                        }
                      }}
                      className={`cursor-pointer whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums transition-colors ${
                        isSelected ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                      } ${cell?.missing ? 'text-text-muted' : 'font-medium text-foreground'}`}
                    >
                      {cell?.display ?? DASH}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {selected && (
      <div
        data-testid="compare-cell-detail"
        className="mt-1.5 rounded-[8px] border border-border bg-surface-muted/45 px-3 py-2 text-[11px] text-text-muted"
      >
        {`${selected.metric} · ${selected.symbol} — ${describeProvenance(selectedCell?.provenance, t)}`}
      </div>
    )}
    </div>
  );
};

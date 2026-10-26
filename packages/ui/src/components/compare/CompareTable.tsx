import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Comparison } from '@finagent/core';
import {
  metricDefinitionForRow,
  type CompareMetricId,
  type CompareRowDensity,
} from '../../lib/compareViewState';

const DASH = '\u2014';

/** Comparison table: one metric per row, one column per symbol. */
export const CompareTable: React.FC<{
  comparison: Comparison;
  visibleMetricIds: readonly CompareMetricId[];
  density: CompareRowDensity;
}> = ({ comparison, visibleMetricIds, density }) => {
  const { t } = useTranslation();
  const cellPadding = density === 'compact' ? 'py-1.5' : 'py-2.5';
  const rows = comparison.rows.filter((row) => {
    const definition = metricDefinitionForRow(row.metric);
    return definition === undefined || visibleMetricIds.includes(definition.id);
  });

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
          {rows.map((row) => {
            const definition = metricDefinitionForRow(row.metric);
            const label = definition !== undefined ? t(definition.labelKey) : row.metric;
            return (
              <tr key={row.metric} className="border-b border-border/70 last:border-0 hover:bg-surface-hover transition-colors">
                <td className={`whitespace-nowrap px-3.5 ${cellPadding} font-medium text-foreground/68`}>{label}</td>
                {comparison.symbols.map((symbol) => (
                  <td
                    key={symbol}
                    className={`whitespace-nowrap px-3.5 ${cellPadding} text-right tabular-nums ${row.cells[symbol]?.missing ? 'text-text-muted' : 'font-medium text-foreground'}`}
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

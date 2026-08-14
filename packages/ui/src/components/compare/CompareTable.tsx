import React from 'react';
import type { Comparison } from '@finagent/core';

const DASH = '\u2014';

/** Comparison table: one metric per row, one column per symbol. */
export const CompareTable: React.FC<{ comparison: Comparison }> = ({ comparison }) => {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-foreground/8" data-testid="compare-table">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-foreground/8">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
              Metric
            </th>
            {comparison.symbols.map((symbol) => (
              <th key={symbol} className="px-3 py-2 text-right tabular-nums text-foreground/70">
                {symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.metric} className="border-b border-foreground/6 last:border-0">
              <td className="px-3 py-2 text-foreground/70">{row.metric}</td>
              {comparison.symbols.map((symbol) => (
                <td key={symbol} className="px-3 py-2 text-right tabular-nums text-foreground">
                  {row.cells[symbol]?.display ?? DASH}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

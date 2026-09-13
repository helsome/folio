import React from 'react';
import type { ComparisonTableBlock } from '@finagent/core';
import { formatBlockValue } from './blockFormat';
import { AnswerBlockFrame } from './AnswerBlockFrame';

/** Side-by-side comparison table from a `comparison_table` block. */
export const ComparisonTableBlockView: React.FC<{ block: ComparisonTableBlock; streaming?: boolean }> = ({
  block,
  streaming,
}) => {
  return (
    <AnswerBlockFrame block={block} streaming={streaming}>
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-hover">
        <table className="min-w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr>
              <th className="border-b mac-section-divider px-2 py-1.5 font-semibold text-foreground/72"> </th>
              {block.columns.map((column) => (
                <th
                  key={column.id}
                  className="whitespace-nowrap border-b mac-section-divider px-2 py-1.5 text-right font-semibold text-foreground/72"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label} className="hover:bg-foreground/[0.03]">
                <td className="whitespace-nowrap border-b mac-section-divider px-2 py-1.5 align-top font-medium text-foreground/82">
                  {row.label}
                </td>
                {row.values.map((value, index) => (
                  <td
                    key={`${row.label}-${block.columns[index]?.id ?? index}`}
                    className="whitespace-nowrap border-b mac-section-divider px-2 py-1.5 text-right align-top font-mono text-foreground/78"
                  >
                    {value === null || typeof value === 'string'
                      ? value ?? '—'
                      : formatBlockValue(value, row.unit ?? 'count', row.currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnswerBlockFrame>
  );
};

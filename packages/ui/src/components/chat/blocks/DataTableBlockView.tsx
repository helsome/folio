import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import type { DataTableBlock } from '@finagent/core';
import { formatBlockValue } from './blockFormat';
import { AnswerBlockFrame } from './AnswerBlockFrame';

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Sortable, horizontally scrollable, copyable data table from a `data_table` block. */
export const DataTableBlockView: React.FC<{ block: DataTableBlock; streaming?: boolean }> = ({
  block,
  streaming,
}) => {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortState>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo(() => sortRows(block.rows, sort), [block.rows, sort]);

  const handleCopy = () => {
    const tsv = [
      block.columns.map((column) => column.label).join('\t'),
      ...rows.map((row) => block.columns.map((column) => formatCell(row[column.key], column.unit, column.currency)).join('\t')),
    ].join('\n');
    navigator.clipboard?.writeText(tsv).catch(() => undefined);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <AnswerBlockFrame
      block={block}
      streaming={streaming}
      headerAction={
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? t('agent.blocks.copied') : t('agent.blocks.copy')}
          aria-label={copied ? t('agent.blocks.copied') : t('agent.blocks.copy')}
          className="flex h-5.5 w-5.5 items-center justify-center rounded-[6px] border mac-section-divider bg-surface p-1 text-foreground/52 transition-smooth hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" strokeWidth={2} /> : <Copy className="h-3 w-3" strokeWidth={1.8} />}
        </button>
      }
    >
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-hover">
        <table className="min-w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr>
              {block.columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    onClick={() => toggleSort(sort, setSort, column.key)}
                    className={`cursor-pointer whitespace-nowrap border-b mac-section-divider px-2 py-1.5 font-semibold text-foreground/72 select-none hover:text-foreground ${
                      column.unit ? 'text-right' : ''
                    }`}
                    title={t('agent.blocks.sortHint')}
                  >
                    {column.label}
                    <span className="ml-0.5 text-[9px] text-foreground/38">{active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-foreground/[0.03]">
                {block.columns.map((column) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap border-b mac-section-divider px-2 py-1.5 align-top text-foreground/78 ${
                      column.unit ? 'text-right font-mono' : ''
                    }`}
                  >
                    {formatCell(row[column.key], column.unit, column.currency)}
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

function toggleSort(current: SortState, setSort: (next: SortState) => void, key: string) {
  if (!current || current.key !== key) {
    setSort({ key, dir: 'asc' });
    return;
  }
  setSort(current.dir === 'asc' ? { key, dir: 'desc' } : null);
}

function sortRows(
  rows: DataTableBlock['rows'],
  sort: SortState
): DataTableBlock['rows'] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  });
  return sort.dir === 'desc' ? sorted.reverse() : sorted;
}

function formatCell(
  value: string | number | null | undefined,
  unit: 'price' | 'percent' | 'ratio' | 'count' | undefined,
  currency: string | undefined
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && unit) return formatBlockValue(value, unit, currency);
  return String(value);
}

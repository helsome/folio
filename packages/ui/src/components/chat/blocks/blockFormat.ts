import type { AnswerBlockUnit } from '@finagent/core';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatPercentRatio,
} from '@finagent/i18n';

/**
 * Map a canonical block unit to the repo-wide locale formatters. `percent`
 * values are already ×100 (1.23 → "1.23%"); `ratio` values are 0..1.
 */
export function formatBlockValue(value: number, unit: AnswerBlockUnit, currency?: string): string {
  switch (unit) {
    case 'price':
      return formatCurrency(value, currency);
    case 'percent':
      return formatPercent(value);
    case 'ratio':
      return formatPercentRatio(value);
    case 'count':
      return formatNumber(value);
  }
}

/** Signed variant for change deltas (price/percent units only). */
export function formatBlockChange(value: number, unit: AnswerBlockUnit, currency?: string): string {
  const formatted = formatBlockValue(Math.abs(value), unit, currency);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`;
}

/** Format an ISO 8601 string through the locale date layer; invalid → em dash. */
export function formatIsoDate(iso: string | undefined): string {
  if (!iso) return '—';
  const epoch = Date.parse(iso);
  if (!Number.isFinite(epoch)) return '—';
  return formatDate(epoch);
}

/** Compact axis label (e.g. "09-01" style) for chart x positions. */
export function formatIsoAxisTick(iso: string): string {
  const epoch = Date.parse(iso);
  if (!Number.isFinite(epoch)) return iso.slice(0, 10);
  const date = new Date(epoch);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

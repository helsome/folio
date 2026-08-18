import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '../../lib/money';

/**
 * One performance table card (spec §38).
 *
 * Skills and strategies share the same presentation: name → samples →
 * directional/hit rate → avg return / median excess return → unable share.
 * Missing metrics render '—' (never a fabricated '0%'); groups below
 * MIN_EVALUATED_SAMPLES carry the Observational Only badge so a handful of
 * samples is never presented as a tuned result.
 */

export interface PerformanceRowView {
  id: string;
  label: string;
  samples: number;
  /** Directional hit rate (skills) or strategy hit rate, 0..1. */
  hitRate?: number;
  /** Avg return (skills) or median excess return (strategies), signed percent. */
  metric?: number;
  /** Share of outcomes that were `unable`, 0..1 (skills only). */
  unableRate?: number;
  insufficientData: boolean;
}

export interface PerformanceCardProps {
  title: string;
  /** Metric column header, e.g. 'Avg Return' or 'Median Excess Return'. */
  metricLabel: string;
  rows: PerformanceRowView[];
  emptyMessage: string;
}

function formatRate(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatSampleCount(samples: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(samples);
}

const HEADER_CELL =
  'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/52';
const BODY_CELL = 'px-2 py-1.5 text-[12px] text-foreground/80';

/** Renders one table card; `rows: []` shows the empty message. */
export const PerformanceCard: React.FC<PerformanceCardProps> = ({
  title,
  metricLabel,
  rows,
  emptyMessage,
}) => {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-[10px] border mac-list-row p-4"
      data-testid="performance-card"
    >
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-text-muted">{emptyMessage}</p>
      ) : (
        <table className="mt-2.5 w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={HEADER_CELL}>{t('performance.name')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.samples')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.hitRate')}</th>
              <th className={`${HEADER_CELL} text-right`}>{metricLabel}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.unable')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-t mac-section-divider"
                data-testid={`performance-row-${row.id}`}
              >
                <td className={`${BODY_CELL} font-medium text-foreground`}>{row.label}</td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatSampleCount(row.samples)}
                </td>
                <td className={`${BODY_CELL} text-right font-mono`}>{formatRate(row.hitRate)}</td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatPercent(row.metric)}
                </td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatRate(row.unableRate)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {row.insufficientData && (
                    <span
                      className="inline-flex items-center rounded-full border border-dashed border-[var(--mac-border)] px-2 py-0.5 text-[10px] text-foreground/56"
                      data-testid="observational-badge"
                    >
                      {t('performance.observationalOnly')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

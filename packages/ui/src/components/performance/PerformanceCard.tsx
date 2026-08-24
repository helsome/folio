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
  'border-b border-[#e2e7ef] bg-[#f7f9fc] px-3 py-2 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#7f8b9d]';
const BODY_CELL = 'border-t border-[#edf0f4] px-3 py-2 text-[12px] leading-5 text-foreground/80';

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
      className="overflow-hidden rounded-[10px] border border-[#dfe5ed] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]"
      data-testid="performance-card"
    >
      <div className="border-b border-[#e2e7ef] bg-[#fbfcfe] px-4 py-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">{title}</h4>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-7 text-[12px] text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0">
            <thead>
            <tr>
              <th scope="col" className={HEADER_CELL}>{t('performance.name')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.samples')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.hitRate')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{metricLabel}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.unable')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.status')}</th>
            </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="group hover:bg-[#f8fbff]"
                  data-testid={`performance-row-${row.id}`}
                >
                  <td className={`${BODY_CELL} font-medium text-foreground`}>{row.label}</td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatSampleCount(row.samples)}
                  </td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>{formatRate(row.hitRate)}</td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatPercent(row.metric)}
                  </td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatRate(row.unableRate)}
                  </td>
                  <td className={`${BODY_CELL} text-right`}>
                    {row.insufficientData && (
                      <span
                        className="inline-flex items-center rounded-[5px] border border-dashed border-[#b8c2d1] bg-[#f8fafc] px-1.5 py-0.5 text-[9.5px] font-medium text-[#66758a]"
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
        </div>
      )}
    </section>
  );
};

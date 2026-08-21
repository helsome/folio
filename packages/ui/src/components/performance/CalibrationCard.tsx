import React from 'react';
import { useTranslation } from 'react-i18next';
import { MIN_CALIBRATION_SAMPLES, WEIGHT_BOUNDS } from '@finagent/core';

/**
 * One calibration table card (spec §39–42, stretch).
 *
 * Transparent view of how a skill's (or strategy's) historical track record
 * would adjust its weight: base weight (1.00) + historical adjustment →
 * final weight, clamped into WEIGHT_BOUNDS — NEVER unbounded. Calibration is
 * INFORMATIONAL ONLY in this version: the research planner does not apply
 * these weights yet (runtime weighting stays future work).
 */

export interface CalibrationRowView {
  id: string;
  label: string;
  baseWeight: number;
  /** `finalBoundedWeight - baseWeight`, signed; undefined below min samples. */
  historicalAdjustment?: number;
  /** Clamped final weight; undefined below min samples. */
  finalWeight?: number;
  samples: number;
  insufficientData: boolean;
}

export interface CalibrationCardProps {
  title: string;
  rows: CalibrationRowView[];
  emptyMessage: string;
}

function formatAdjustment(adjustment: number | undefined): string {
  if (adjustment === undefined || !Number.isFinite(adjustment)) return '—';
  const sign = adjustment > 0 ? '+' : '';
  return `${sign}${adjustment.toFixed(2)}`;
}

function formatWeight(weight: number | undefined): string {
  if (weight === undefined || !Number.isFinite(weight)) return '—';
  return weight.toFixed(2);
}

function formatSampleCount(samples: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(samples);
}

const HEADER_CELL =
  'border-b border-[#e2e7ef] bg-[#f7f9fc] px-3 py-2 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#7f8b9d]';
const BODY_CELL = 'border-t border-[#edf0f4] px-3 py-2 text-[12px] leading-5 text-foreground/80';

/** Renders one calibration table card; `rows: []` shows the empty message. */
export const CalibrationCard: React.FC<CalibrationCardProps> = ({ title, rows, emptyMessage }) => {
  const { t } = useTranslation();
  return (
    <section
      className="overflow-hidden rounded-[10px] border border-[#dfe5ed] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]"
      data-testid="calibration-card"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-[#e2e7ef] bg-[#fbfcfe] px-4 py-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">{title}</h4>
        <p className="text-right text-[10px] tabular-nums text-text-muted">
          {t('performance.finalWeightBounded', { min: WEIGHT_BOUNDS.min.toFixed(2), max: WEIGHT_BOUNDS.max.toFixed(2) })}
        </p>
      </div>
      <p className="border-b border-[#edf0f4] px-4 py-2 text-[10px] leading-4 text-text-muted">
        {t('performance.calibrationNote', { min: MIN_CALIBRATION_SAMPLES })}
      </p>
      {rows.length === 0 ? (
        <p className="px-4 py-7 text-[12px] text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0">
            <thead>
            <tr>
              <th scope="col" className={HEADER_CELL}>{t('performance.name')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.baseWeight')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.historicalAdjustment')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.finalBounded')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.samples')}</th>
              <th scope="col" className={`${HEADER_CELL} text-right`}>{t('performance.status')}</th>
            </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="group hover:bg-[#f8fbff]"
                  data-testid={`calibration-row-${row.id}`}
                >
                  <td className={`${BODY_CELL} font-medium text-foreground`}>{row.label}</td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>{row.baseWeight.toFixed(2)}</td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatAdjustment(row.historicalAdjustment)}
                  </td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatWeight(row.finalWeight)}
                  </td>
                  <td className={`${BODY_CELL} text-right font-mono tabular-nums`}>
                    {formatSampleCount(row.samples)}
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

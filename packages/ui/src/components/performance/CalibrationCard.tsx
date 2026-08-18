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
  'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/52';
const BODY_CELL = 'px-2 py-1.5 text-[12px] text-foreground/80';

/** Renders one calibration table card; `rows: []` shows the empty message. */
export const CalibrationCard: React.FC<CalibrationCardProps> = ({ title, rows, emptyMessage }) => {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-[10px] border mac-list-row p-4"
      data-testid="calibration-card"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{title}</h4>
        <p className="text-[10px] text-text-muted">
          {t('performance.finalWeightBounded', { min: WEIGHT_BOUNDS.min.toFixed(2), max: WEIGHT_BOUNDS.max.toFixed(2) })}
        </p>
      </div>
      <p className="mt-0.5 text-[10px] text-text-muted">
        {t('performance.calibrationNote', { min: MIN_CALIBRATION_SAMPLES })}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-text-muted">{emptyMessage}</p>
      ) : (
        <table className="mt-2.5 w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={HEADER_CELL}>{t('performance.name')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.baseWeight')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.historicalAdjustment')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.finalBounded')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.samples')}</th>
              <th className={`${HEADER_CELL} text-right`}>{t('performance.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-t mac-section-divider"
                data-testid={`calibration-row-${row.id}`}
              >
                <td className={`${BODY_CELL} font-medium text-foreground`}>{row.label}</td>
                <td className={`${BODY_CELL} text-right font-mono`}>{row.baseWeight.toFixed(2)}</td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatAdjustment(row.historicalAdjustment)}
                </td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatWeight(row.finalWeight)}
                </td>
                <td className={`${BODY_CELL} text-right font-mono`}>
                  {formatSampleCount(row.samples)}
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

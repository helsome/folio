import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PortfolioImportDraft, PortfolioImportRow } from '@finagent/core';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { formatCurrency, formatNumber } from '@finagent/i18n';

/**
 * Draft review step of the portfolio import flow (spec §47–48).
 *
 * Shows every parsed row with a confidence badge; low-confidence rows are
 * highlighted and labeled "review required". The user names the portfolio and
 * explicitly confirms — nothing is persisted before this screen's Confirm.
 */

export interface ConfidenceVisual {
  key: string;
  tone: 'high' | 'medium' | 'low';
}

/** Confidence tier presentation (spec §48) — pure, unit-testable. */
export function confidenceVisual(confidence: number): ConfidenceVisual {
  if (confidence >= 1) return { key: 'portfolio.confidence.high', tone: 'high' };
  if (confidence >= 0.6) return { key: 'portfolio.confidence.review', tone: 'medium' };
  return { key: 'portfolio.confidence.needsReview', tone: 'low' };
}

const TONE_CLASS: Record<ConfidenceVisual['tone'], string> = {
  high: 'bg-[var(--mac-green)]/14 text-[var(--mac-green)]',
  medium: 'bg-[var(--mac-yellow)]/14 text-[var(--mac-yellow)]',
  low: 'bg-[var(--mac-red)]/14 text-[var(--mac-red)]',
};

function RowLine({ row }: { row: PortfolioImportRow }) {
  const { t } = useTranslation();
  const visual = confidenceVisual(row.confidence);
  const needsReview = row.confidence < 1;
  return (
    <tr
      className={
        needsReview
          ? 'border-b border-[var(--mac-border)] bg-[var(--mac-yellow)]/6'
          : 'border-b border-[var(--mac-border)]'
      }
    >
      <td className="py-2 pr-3 text-[12px] font-semibold text-foreground">{row.symbol || '—'}</td>
      <td className="py-2 pr-3 text-[12px] text-foreground/60">{row.name ?? '—'}</td>
      <td className="py-2 pr-3 text-right text-[12px] text-foreground/80">
        {formatNumber(row.quantity, undefined, { maximumFractionDigits: 0 })}
      </td>
      <td className="py-2 pr-3 text-right text-[12px] text-foreground/80">
        {formatCurrency(row.costPrice, row.currency)}
      </td>
      <td className="py-2 pr-3 text-[12px] text-foreground/60">{row.currency ?? '—'}</td>
      <td className="py-2 pr-3">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[visual.tone]}`}
        >
          {t(visual.key)}
        </span>
        {needsReview && (
          <span className="ml-1.5 text-[10px] text-foreground/50">
            {t('portfolio.import.reviewRequired')}
          </span>
        )}
      </td>
      <td className="py-2 pr-1 text-[11px] text-foreground/50">{row.issues.join(' · ') || ''}</td>
    </tr>
  );
}

export interface ImportDraftReviewProps {
  draft: PortfolioImportDraft;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  confirming?: boolean;
  confirmError?: string | null;
}

export const ImportDraftReview: React.FC<ImportDraftReviewProps> = ({
  draft,
  onCancel,
  onConfirm,
  confirming = false,
  confirmError = null,
}) => {
  const { t } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);
  const needsReview = draft.rows.some((row) => row.confidence < 1);
  const sourceKey =
    draft.source === 'paste' ? 'portfolio.import.sourcePasted' : 'portfolio.import.sourceCsv';

  return (
    <div className="space-y-4">
      <div className="text-[13px] text-foreground/70">
        {t('portfolio.import.rowsParsed', { count: draft.rows.length, source: t(sourceKey) })}
      </div>

      {draft.warnings.length > 0 && (
        <div className="rounded-[10px] bg-[var(--mac-yellow)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {draft.warnings.map((warning) => (
            <div key={warning}>• {warning}</div>
          ))}
        </div>
      )}

      {needsReview && (
        <div className="rounded-[10px] bg-[var(--mac-yellow)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {t('portfolio.import.lowConfidence')}
        </div>
      )}

      <Input
        label={t('portfolio.import.portfolioName')}
        ref={nameRef}
        defaultValue={t('portfolio.import.portfolioNameDefault')}
        placeholder={t('portfolio.import.portfolioNamePlaceholder')}
      />

      <div className="max-h-56 overflow-y-auto rounded-[10px] border border-[var(--mac-border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--mac-border)] bg-foreground/4">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnSymbol')}
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnName')}
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnQty')}
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnCost')}
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnCcy')}
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnConfidence')}
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
                {t('portfolio.import.columnIssues')}
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <RowLine key={`${row.symbol}-${index}`} row={row} />
            ))}
          </tbody>
        </table>
        {draft.rows.length === 0 && (
          <div className="py-8 text-center text-[13px] text-foreground/44">
            {t('portfolio.import.noRows')}
          </div>
        )}
      </div>

      {confirmError && (
        <div className="rounded-[10px] bg-[var(--mac-red)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {confirmError}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={confirming}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => onConfirm(nameRef.current?.value ?? t('portfolio.import.portfolioNameDefault'))}
          disabled={confirming || draft.rows.length === 0}
        >
          {confirming ? t('portfolio.import.importing') : t('portfolio.import.confirmImport')}
        </Button>
      </div>
    </div>
  );
};

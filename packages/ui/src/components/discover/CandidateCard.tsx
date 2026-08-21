import React, { useEffect, useRef, useState } from 'react'
import { Check, Ellipsis, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SupportedLocale } from '@finagent/i18n'
import type { ScreeningCandidate } from '@finagent/core'
import { Button } from '../primitives/Button'
import {
  formatScreeningMetric,
  SCREENING_METRIC_DISPLAY,
  type ScreeningMetricKey,
} from '../../lib/screeningMetrics'

export type CandidateAction = 'research' | 'compare' | 'watch'

export interface CandidateCardProps {
  candidate: ScreeningCandidate
  watched: boolean
  onAction: (action: CandidateAction, candidate: ScreeningCandidate) => void
  locale: SupportedLocale
}

type SecondaryAction = Exclude<CandidateAction, 'research'>

/**
 * Dense candidate row (spec §17–21): a stable column list —
 * Security / Price / Change / Score / Action. Metrics render through the
 * screening presentation layer (no raw provider keys, no long floats).
 * Research is the explicit primary action; Compare / Watch live in a
 * secondary More menu. Watch state is derived from the real watchlist atom
 * (via the `watched` prop) — never component-local.
 */
export const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, onAction, watched, locale }) => {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the More menu on outside click or Escape (mirrors ExportMenu).
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const price = formatScreeningMetric('lastPrice', candidate.metrics.lastPrice, locale)
  const change = formatScreeningMetric('changePercent', candidate.metrics.changePercent, locale)
  const scoreLabel = candidate.score !== undefined ? `${Math.round(candidate.score * 100)}` : '—'

  // Any other canonical metrics (PE / ROE / volume …) render as subtle text.
  const extraMetrics = (Object.keys(candidate.metrics) as string[]).filter(
    (key) => key !== 'lastPrice' && key !== 'changePercent'
  ).map((key) => formatScreeningMetric(key, candidate.metrics[key], locale)).filter((r): r is { key: ScreeningMetricKey; text: string } => r !== null)

  const changeTone = candidate.metrics.changePercent === undefined
    ? 'text-foreground/70'
    : Number(candidate.metrics.changePercent) >= 0
      ? 'text-positive'
      : 'text-negative'

  const runSecondary = (action: SecondaryAction): void => {
    setMenuOpen(false)
    onAction(action, candidate)
  }

  return (
    <div
      data-testid={`candidate-${candidate.symbol}`}
      className="folio-pilot-row"
    >
      {/* Security */}
      <div className="folio-pilot-identity">
        <div className="folio-pilot-symbol-line">
          <span className="folio-pilot-symbol">{candidate.symbol}</span>
          <span className="folio-pilot-name">{candidate.name}</span>
        </div>
        {candidate.reasons[0] && <div className="folio-pilot-reason">{candidate.reasons[0]}</div>}
        <div className="folio-pilot-secondary">
          {candidate.reasons.slice(1, 3).map((reason) => (
            <span key={reason} className="folio-pilot-chip">
              {reason}
            </span>
          ))}
          {extraMetrics.length > 0 && (
            <span className="truncate text-[10px] text-foreground/40">
              {extraMetrics
                .map((m) => `${t(`discover.metric.${SCREENING_METRIC_DISPLAY[m.key].labelKey}`)} ${m.text}`)
                .join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Price */}
      <div className="text-right">
        <span data-testid={`candidate-price-${candidate.symbol}`} className="tnum text-[12.5px] font-medium text-foreground/78">
          {price?.text ?? '—'}
        </span>
      </div>

      {/* Change */}
      <div className="text-right">
        <span data-testid={`candidate-change-${candidate.symbol}`} className={`tnum text-[12.5px] font-medium ${changeTone}`}>
          {change?.text ?? '—'}
        </span>
      </div>

      {/* Score */}
      <div className="text-right">
        <span data-testid={`candidate-score-${candidate.symbol}`} className="tnum text-[12.5px] font-semibold text-accent">
          {scoreLabel}
        </span>
      </div>

      {/* Action */}
      <div className="folio-pilot-action">
        <Button
          variant="default"
          size="sm"
          onClick={() => onAction('research', candidate)}
          data-testid={`candidate-research-${candidate.symbol}`}
          aria-label={t('discover.research', { symbol: candidate.symbol })}
          title={t('discover.research')}
        >
          <Search className="h-3.5 w-3.5" />
          {t('discover.research')}
        </Button>

        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('discover.more')}
            title={t('discover.more')}
            data-testid={`candidate-more-${candidate.symbol}`}
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-44 rounded-[10px] border border-border bg-[var(--mac-window)] p-1 shadow-xl"
              data-testid={`candidate-more-menu-${candidate.symbol}`}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => runSecondary('compare')}
                className="block w-full rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-foreground/85 transition-smooth hover:bg-surface-hover"
                data-testid={`candidate-compare-${candidate.symbol}`}
              >
                {t('discover.compare')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runSecondary('watch')}
                className="flex w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-foreground/85 transition-smooth hover:bg-surface-hover"
                data-testid={`candidate-watch-${candidate.symbol}`}
              >
                {watched && <Check className="h-3.5 w-3.5 text-positive" />}
                {watched ? t('discover.added') : t('discover.watch')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

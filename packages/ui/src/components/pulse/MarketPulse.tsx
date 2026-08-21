import React, { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { ScreeningCandidate } from '@finagent/core'
import { loadPulseAtom, pulseCacheAtom } from '../../atoms/pulseAtoms'
import { useFinagentClient } from '../../client'
import {
  partitionPulseMovers,
  toFiniteNumber,
  type PulseImpactSign,
  type PulseMarketIndex,
  type PulsePersonalImpactItem,
} from '../../client/pulse'
import { formatPercent } from '../../lib/money'
import { SectionState, TodaySection } from '../today/TodaySection'

const DASH = '\u2014'

/**
 * Market Pulse card for the Today dashboard (spec §51–52). Standalone: no
 * props, self-loads via its own atoms (`pulseAtoms` × `useFinagentClient`).
 *
 * Every number is REAL capability data produced by the main-process
 * `PulseService`; when a section has nothing, it renders an honest empty
 * state — the card never fabricates a quote or a change.
 */

function changeColor(changePercent: number | undefined): string {
  if (changePercent === undefined) return 'text-foreground/42'
  if (changePercent > 0) return 'text-[var(--mac-green)]'
  if (changePercent < 0) return 'text-[var(--mac-red)]'
  return 'text-foreground/42'
}

function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatExposure(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return DASH
  return `${value.toFixed(1)}%`
}

function impactLabel(impact: PulseImpactSign, t: (key: string) => string): string {
  switch (impact) {
    case 'positive':
      return t('today.impact.positive')
    case 'negative':
      return t('today.impact.negative')
    default:
      return t('today.impact.neutral')
  }
}

function impactColor(impact: PulseImpactSign): string {
  switch (impact) {
    case 'positive':
      return 'text-[var(--mac-green)]'
    case 'negative':
      return 'text-[var(--mac-red)]'
    default:
      return 'text-foreground/48'
  }
}

const IndexLine: React.FC<{ index: PulseMarketIndex }> = ({ index }) => (
  <div className="flex min-w-0 items-baseline gap-2 px-3 py-2.5 text-[13px]" data-testid="pulse-index">
    <span className="font-medium text-foreground/80">{index.name}</span>
    <span className="text-foreground/42">{index.symbol}</span>
    <span className="ml-auto font-mono tabular-nums text-foreground/64">{formatPrice(index.lastPrice)}</span>
    <span className={`font-mono tabular-nums ${changeColor(index.changePercent)}`}>
      {formatPercent(index.changePercent)}
    </span>
  </div>
)

const StatusLine: React.FC<{ statuses: { market: string; status: string }[] }> = ({ statuses }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-foreground/64" data-testid="pulse-market-status">
    {statuses.map((status) => `${status.market} · ${status.status}`).join('  ')}
  </div>
)

const TemperatureChip: React.FC<{ score?: number; label?: string; market?: string }> = ({
  score,
  label,
  market,
}) => {
  const tone = score === undefined ? 'text-foreground/42' : score >= 60 ? 'text-[var(--mac-green)]' : score <= 40 ? 'text-[var(--mac-red)]' : 'text-foreground/64'
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="pulse-temperature">
      <span className={`rounded-[5px] border border-border bg-background px-2 py-0.5 text-[12px] font-mono tabular-nums ${tone}`}>
        {score === undefined ? DASH : `${score}/100`}
      </span>
      {label && <span className="text-[13px] text-foreground/64">{label}</span>}
      {market && <span className="text-[12px] text-foreground/42">{market}</span>}
    </span>
  )
}

const MoverRow: React.FC<{ mover: ScreeningCandidate }> = ({ mover }) => {
  const changePercent = toFiniteNumber(mover.metrics.changePercent)
  return (
    <li className="flex items-baseline justify-between gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0" data-testid="pulse-mover-row">
      <span className="truncate font-medium text-foreground/80">{mover.symbol}</span>
      <span className={`font-mono tabular-nums ${changeColor(changePercent)}`}>{formatPercent(changePercent)}</span>
    </li>
  )
}

const MoverColumn: React.FC<{ title: string; empty: string; movers: ScreeningCandidate[] }> = ({ title, empty, movers }) => (
  <div className="rounded-[8px] border border-border bg-surface-raised p-3">
    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">{title}</h4>
    {movers.length === 0 ? (
      <p className="py-1 text-[13px] text-foreground/42">{empty}</p>
    ) : (
      <ul className="space-y-1">
        {movers.map((mover) => (
          <MoverRow key={mover.symbol} mover={mover} />
        ))}
      </ul>
    )}
  </div>
)

const ImpactRow: React.FC<{ item: PulsePersonalImpactItem }> = ({ item }) => {
  const { t } = useTranslation()
  return (
  <li className="flex items-center justify-between gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0" data-testid="pulse-impact-row">
    <span className="truncate font-medium text-foreground/80">{item.symbol}</span>
    <span className="flex items-center gap-3 tabular-nums">
      <span className="font-mono text-foreground/64" title="{t('today.watchlistWeightShare')}">
        {formatExposure(item.watchlistExposurePercent)}
      </span>
      {item.portfolioExposurePercent !== undefined && (
        <span className="font-mono text-foreground/64" title="{t('today.portfolioExposure')}">
          {formatExposure(item.portfolioExposurePercent)}
        </span>
      )}
      <span className={`text-[12px] ${impactColor(item.impact)}`}>{impactLabel(item.impact, t)}</span>
    </span>
  </li>
  )
}

export const MarketPulse: React.FC = () => {
  const { t } = useTranslation()
  const client = useFinagentClient()
  const { snapshot, loading, error } = useAtomValue(pulseCacheAtom)
  const loadPulse = useSetAtom(loadPulseAtom)

  useEffect(() => {
    loadPulse(client)
  }, [client, loadPulse])

  const movers = snapshot ? partitionPulseMovers(snapshot.movers) : { gainers: [], losers: [] }
  const statuses = snapshot?.marketStatus ?? []
  const temperature = snapshot?.temperature ?? null

  return (
    <TodaySection title={t('today.marketPulse')}>
      {loading ? (
        <SectionState kind="loading" />
      ) : error && !snapshot ? (
        <SectionState kind="error" message={error} />
      ) : (
        <div className="space-y-3" data-testid="pulse-snapshot">
          <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-[8px] border border-border bg-surface-raised sm:grid-cols-2 sm:divide-x sm:divide-y-0" data-testid="pulse-indices">
            {snapshot && snapshot.indices.length > 0 ? (
              snapshot.indices.map((index) => <IndexLine key={index.symbol} index={index} />)
            ) : (
              <span className="text-[13px] text-foreground/42">{t('today.indexQuotesUnavailable')}</span>
            )}
          </div>

          {snapshot && statuses.length > 0 ? (
            <div className="rounded-[8px] border border-border bg-background px-3 py-2.5">
              <StatusLine statuses={statuses} />
            </div>
          ) : (
            <p className="text-[13px] text-foreground/42">{t('today.marketStatusUnavailable')}</p>
          )}

          {snapshot && temperature ? (
            <div className="flex items-center rounded-[8px] border border-border bg-surface-raised px-3 py-2.5">
              <TemperatureChip
                score={temperature.score}
                label={temperature.label}
                market={temperature.market}
              />
            </div>
          ) : (
            <p className="text-[13px] text-foreground/42">{t('today.marketTemperatureUnavailable')}</p>
          )}

          <div className="grid grid-cols-2 gap-3" data-testid="pulse-movers">
            <MoverColumn title={t('today.topGainers')} empty={t('today.noColumnMovers')} movers={movers.gainers} />
            <MoverColumn title={t('today.topLosers')} empty={t('today.noColumnMovers')} movers={movers.losers} />
          </div>

          <div className="rounded-[8px] border border-border bg-surface-raised p-3" data-testid="pulse-personal-impact">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
              {t('today.whatMattersToMe')}
            </h4>
            {snapshot?.personalImpact && snapshot.personalImpact.items.length > 0 ? (
              <ul className="space-y-1">
                {snapshot.personalImpact.items.map((item) => (
                  <ImpactRow key={item.symbol} item={item} />
                ))}
              </ul>
            ) : (
              <p className="py-1 text-[13px] text-foreground/42">{t('today.noWatchlistMovers')}</p>
            )}
          </div>

          {snapshot && snapshot.failures.length > 0 && (
            <p className="pt-1 text-[12px] text-foreground/42" data-testid="pulse-failures-note">
              {t('today.someDataUnavailable')}
            </p>
          )}
        </div>
      )}
    </TodaySection>
  )
}

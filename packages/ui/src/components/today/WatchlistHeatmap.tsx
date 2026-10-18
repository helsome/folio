import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WatchlistHeatmapItem } from '../../atoms/todayAtoms'
import { formatPercent } from '../../lib/money'

interface WatchlistHeatmapProps {
  items: WatchlistHeatmapItem[]
  onSelect: (symbol: string) => void
}

const CACHE_TTL_MS = 30_000

function tileColor(changePercent: number | null): string {
  if (changePercent === null) return 'var(--surface)'
  const strength = Math.min(Math.abs(changePercent) / 12, 1)
  const tint = `${8 + strength * 22}%`
  const color = changePercent > 0 ? 'var(--positive)' : changePercent < 0 ? 'var(--negative)' : 'var(--foreground)'
  return `color-mix(in srgb, ${color} ${tint}, var(--surface))`
}

export const WatchlistHeatmap: React.FC<WatchlistHeatmapProps> = ({ items, onSelect }) => {
  const { t } = useTranslation()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CACHE_TTL_MS)
    return () => clearInterval(timer)
  }, [])

  if (items.length === 0) {
    return <p className="py-8 text-center text-[12px] text-foreground/50">{t('today.heatmapEmpty')}</p>
  }

  return (
    <div data-testid="watchlist-heatmap">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-foreground/52">{t('today.heatmapIndustryUnavailable')}</p>
        <div className="flex items-center gap-3 text-[10px] text-foreground/60" aria-label={t('today.heatmapLegend')}>
          <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-positive/70" />{t('today.heatmapGains')}</span>
          <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-negative/70" />{t('today.heatmapLosses')}</span>
          <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-foreground/12" />{t('today.heatmapFlat')}</span>
          <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm border border-border bg-surface" />{t('today.heatmapUnavailable')}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label={t('today.watchlistHeatmap')}>
        {items.map((item) => {
          const status = item.changePercent === null
            ? t('today.heatmapUnavailable')
            : item.fetchedAt === null || nowMs - item.fetchedAt > CACHE_TTL_MS
              ? t('today.heatmapCached') : t('today.heatmapCurrent')
          const change = item.changePercent === null ? t('today.heatmapUnavailable') : formatPercent(item.changePercent)
          const fetched = item.fetchedAt === null ? t('today.heatmapNoTimestamp') : new Date(item.fetchedAt).toLocaleString()
          const label = t('today.heatmapTileLabel', { symbol: item.symbol, change, status })
          return (
            <button
              key={item.symbol}
              type="button"
              data-testid={`heatmap-tile-${item.symbol}`}
              aria-label={label}
              title={`${label} · ${t('today.heatmapFetchedAt', { time: fetched })}${item.isDemo ? ` · ${t('today.heatmapSampleData')}` : ''}`}
              onClick={() => onSelect(item.symbol)}
              className="flex min-h-20 flex-col items-start justify-between rounded-[9px] border border-border/80 p-2.5 text-left transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              style={{ backgroundColor: tileColor(item.changePercent) }}
            >
              <span className="text-[12px] font-semibold text-foreground">{item.symbol}</span>
              <span className="text-[11px] font-semibold text-foreground/80">{change}</span>
              <span className="text-[10px] text-foreground/60">
                {item.isDemo ? t('today.heatmapSampleData') : status}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

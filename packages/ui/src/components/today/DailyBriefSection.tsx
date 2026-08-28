import React, { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useFinagentClient } from '../../client'
import { automationStateAtom, loadBriefAtom } from '../../atoms/automationAtoms'
import type { BriefItem, BriefItemSource, BriefSeverity } from '../../client/automation'
import { Button } from '../primitives/Button'
import { DemoBadge } from '../primitives/DemoBadge'
import { SectionState, TodaySection } from './TodaySection'
import { demoDailyBrief } from '../../demo/demoData'

interface DailyBriefSectionProps {
  /** Opens the automation management drawer (wired by TodayView). */
  onManage: () => void
}

const SOURCE_DOT: Record<BriefItemSource, string> = {
  Portfolio: 'bg-[var(--mac-accent)]',
  Watchlist: 'bg-[var(--mac-green)]',
  Thesis: 'bg-[#a78bfa]',
  Alert: 'bg-[var(--mac-red)]',
  Automation: 'bg-foreground/40',
}

const SEVERITY_RAIL: Record<BriefSeverity, string> = {
  critical: 'bg-[#d92d20]',
  warning: 'bg-[#f79009]',
  info: 'bg-[#98a2b3]',
}

function briefTitle(item: BriefItem, t: TFunction): string {
  const title = item.symbol && !item.title.startsWith(item.symbol)
    ? `${item.symbol} · ${item.title}`
    : item.title
  const exposure = /^(.*?)(?:\s·\s)?(\d+(?:\.\d+)?)%\s+of portfolio$/i.exec(title)
  if (item.source === 'Portfolio' && exposure) {
    const symbol = item.symbol ?? exposure[1].trim()
    return `${symbol} · ${t('today.portfolioExposureDetail', { percent: exposure[2] })}`
  }
  return title
}

function briefMessage(item: BriefItem, t: TFunction): string {
  if (item.source === 'Portfolio') {
    const percent = /(\d+(?:\.\d+)?)%\s+of portfolio/i.exec(item.title)?.[1]
    if (percent) return ''
  }
  return item.message
}

/** Today-section rendering of the Daily Brief (spec §27–28). */
export const DailyBriefSection: React.FC<DailyBriefSectionProps> = ({ onManage }) => {
  const { t } = useTranslation()
  const client = useFinagentClient()
  const { brief, briefLoading } = useAtomValue(automationStateAtom)
  const loadBrief = useSetAtom(loadBriefAtom)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    void loadBrief(client)
  }, [client, loadBrief])

  const content = (() => {
    if (brief === null && briefLoading) return <SectionState kind="loading" />
    // Brief unavailable (no automation/LLM runtime): render the badged sample
    // brief so the dashboard shows a populated default instead of an empty state.
    const briefIsDemo = brief === null && !briefLoading
    const activeBrief = briefIsDemo ? demoDailyBrief(t) : brief
    if (activeBrief === null) {
      return <SectionState kind="empty" message={t('today.dailyBriefUnavailable')} />
    }
    if (activeBrief.items.length === 0 && activeBrief.quiet.count === 0) {
      return <SectionState kind="empty" message={t('today.nothingToReport')} />
    }
    return (
      <div className="space-y-3">
        <div className="folio-daily-brief-overview">
          <div className="flex min-w-0 items-center gap-3">
            <span className="folio-daily-brief-count">{activeBrief.items.length}</span>
            <div className="min-w-0">
              <div className="folio-daily-brief-overview-label">{t('today.dailyBriefAttention')}</div>
              <div className="folio-daily-brief-overview-copy">{t('today.dailyBriefCount', { count: activeBrief.items.length })}</div>
            </div>
          </div>
          <div className="folio-daily-brief-updated">
            <span className="h-1.5 w-1.5 rounded-full bg-[#12b76a]" />
            {t('today.dailyBriefUpdated')}
          </div>
          <span className="sr-only">{activeBrief.summary}</span>
        </div>
        <ul className="folio-daily-brief-list" data-testid="brief-items">
          {activeBrief.items.map((item) => (
            <BriefRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() =>
                setExpandedId((current) => (current === item.id ? null : item.id))
              }
            />
          ))}
        </ul>
        {activeBrief.quiet.count > 0 && (
          <div className="folio-daily-brief-quiet" data-testid="brief-quiet">
            <span className="folio-daily-brief-quiet-dot" />
            <span>{t('today.dailyBriefQuietLabel')}</span>
            <span className="text-foreground/45">{activeBrief.quiet.message}</span>
          </div>
        )}
      </div>
    )
  })()

  return (
    <TodaySection
      title={t('today.dailyBrief')}
      className="folio-daily-brief-section"
      action={
        <div className="flex items-center gap-2">
          {brief === null && !briefLoading && <DemoBadge />}
          <Button variant="outline" size="sm" onClick={onManage}>
            {t('today.manage')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void loadBrief(client)}>
            {t('common.refresh')}
          </Button>
        </div>
      }
    >
      {content}
    </TodaySection>
  )
}

interface BriefRowProps {
  item: BriefItem
  expanded: boolean
  onToggle: () => void
}

const BriefRow: React.FC<BriefRowProps> = ({ item, expanded, onToggle }) => {
  const { t } = useTranslation()
  const message = briefMessage(item, t)
  return (
    <li className="folio-daily-brief-row">
      <span className={`folio-daily-brief-severity ${SEVERITY_RAIL[item.severity]}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_DOT[item.source]}`} />
          <span className="truncate text-[12.5px] font-medium text-foreground">{briefTitle(item, t)}</span>
        </div>
        {message && <div className="mt-1 truncate text-[11.5px] text-foreground/54">{message}</div>}
      </div>
      <div className="folio-daily-brief-meta">
        <span className="folio-daily-brief-source">{t(`today.source.${item.source}`)}</span>
        {item.payload !== undefined && (
          <button type="button" onClick={onToggle} className="folio-daily-brief-details" aria-expanded={expanded}>
            {expanded ? t('today.hide') : t('today.whySeeingThis')}
          </button>
        )}
      </div>
      {expanded && item.payload !== undefined && (
        <pre className="col-span-full mt-1.5 overflow-x-auto rounded-[8px] border border-border bg-surface-raised p-2 text-[11px] leading-relaxed text-foreground/60">
          {JSON.stringify(item.payload, null, 2)}
        </pre>
      )}
    </li>
  )
}

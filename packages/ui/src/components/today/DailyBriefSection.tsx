import React, { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useFinagentClient } from '../../client'
import { automationStateAtom, loadBriefAtom } from '../../atoms/automationAtoms'
import type { BriefItem, BriefItemSource } from '../../client/automation'
import { Button } from '../primitives/Button'
import { SectionState, TodaySection } from './TodaySection'

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

/** Today-section rendering of the Daily Brief (spec §27–28). */
export const DailyBriefSection: React.FC<DailyBriefSectionProps> = ({ onManage }) => {
  const client = useFinagentClient()
  const { brief, briefLoading } = useAtomValue(automationStateAtom)
  const loadBrief = useSetAtom(loadBriefAtom)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    void loadBrief(client)
  }, [client, loadBrief])

  const content = (() => {
    if (brief === null && briefLoading) return <SectionState kind="loading" />
    if (brief === null) {
      return <SectionState kind="empty" message="Daily Brief is not available yet." />
    }
    if (brief.items.length === 0 && brief.quiet.count === 0) {
      return <SectionState kind="empty" message="Nothing to report." />
    }
    return (
      <div className="space-y-2">
        <div className="text-[13px] font-medium text-foreground">{brief.summary}</div>
        <ul className="space-y-1" data-testid="brief-items">
          {brief.items.map((item) => (
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
        {brief.quiet.count > 0 && (
          <div className="pt-1 text-[12px] text-foreground/42" data-testid="brief-quiet">
            {brief.quiet.message}
          </div>
        )}
      </div>
    )
  })()

  return (
    <TodaySection
      title="Daily Brief"
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onManage}>
            Manage
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void loadBrief(client)}>
            Refresh
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

const BriefRow: React.FC<BriefRowProps> = ({ item, expanded, onToggle }) => (
  <li className="rounded-[9px] border border-border bg-surface/60 px-3 py-2">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_DOT[item.source]}`}
          />
          <span className="truncate text-[13px] font-medium text-foreground">
            {item.symbol ? `${item.symbol} · ` : ''}
            {item.title}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-foreground/54">{item.message}</div>
      </div>
      <span className="shrink-0 rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/54">
        {item.source}
      </span>
    </div>
    {item.payload !== undefined && (
      <button
        type="button"
        onClick={onToggle}
        className="mt-1.5 text-[11px] text-foreground/38 underline-offset-2 hover:text-foreground/60 hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? 'Hide' : 'Why am I seeing this?'}
      </button>
    )}
    {expanded && item.payload !== undefined && (
      <pre className="mt-1.5 overflow-x-auto rounded-[8px] bg-foreground/5 p-2 text-[11px] leading-relaxed text-foreground/60">
        {JSON.stringify(item.payload, null, 2)}
      </pre>
    )}
  </li>
)

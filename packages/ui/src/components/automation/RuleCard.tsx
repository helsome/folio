import React from 'react'
import { useTranslation } from 'react-i18next'
import type { AutomationRule, AutomationRun, AutomationType } from '@finagent/core'
import { i18nCurrentLocale } from '@finagent/i18n'

interface RuleCardProps {
  rule: AutomationRule
  lastRun?: AutomationRun
  running: boolean
  onToggle: (rule: AutomationRule) => void
  onRun: (ruleId: string) => void
}

/** Automation type id → translation key (ids are never translated). */
export const AUTOMATION_TYPE_KEYS: Record<AutomationType, string> = {
  'watchlist-daily-review': 'automation.type.watchlistDailyReview',
  'portfolio-daily-brief': 'automation.type.portfolioDailyBrief',
  'weekly-thesis-review': 'automation.type.weeklyThesisReview',
  'pre-earnings-research': 'automation.type.preEarningsResearch',
  'post-earnings-research': 'automation.type.postEarningsResearch',
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string

function formatWhen(timestamp: number, t: TFunc): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return t('automation.schedule.justNow')
  if (diff < 3_600_000) return t('automation.schedule.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('automation.schedule.hoursAgo', { count: Math.floor(diff / 3_600_000) })
  return new Intl.DateTimeFormat(i18nCurrentLocale(), { month: 'short', day: 'numeric' }).format(timestamp)
}

const WEEKDAYS = [1, 2, 3, 4, 5]

function daySummary(days: number[], t: TFunc): string {
  if (days.length === 0) return ''
  if (days.length === 7) return t('automation.schedule.daily')
  if (days.length === 5 && WEEKDAYS.every((day) => days.includes(day))) {
    return t('automation.schedule.weekdays')
  }
  // Arbitrary weekday subset — locale-aware short names via a reference Sunday.
  const names = days.map(
    (day) =>
      new Intl.DateTimeFormat(i18nCurrentLocale(), { weekday: 'short' }).format(
        new Date(Date.UTC(2026, 0, 4 + day))
      )
  )
  return names.join(', ')
}

/** Localized schedule line (mirrors the atoms ruleScheduleSummary logic). */
function scheduleSummary(rule: AutomationRule, t: TFunc): string {
  switch (rule.type) {
    case 'watchlist-daily-review':
    case 'portfolio-daily-brief': {
      const decimal = rule.hour ?? 16.5
      const hour = Math.floor(decimal)
      const minute = Math.round((decimal - hour) * 60)
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      const days = rule.days !== undefined && rule.days.length > 0 ? rule.days : WEEKDAYS
      return `${daySummary(days, t)} ${time}`
    }
    case 'weekly-thesis-review':
      return t('automation.schedule.sundays', { time: '09:00' })
    case 'pre-earnings-research':
    case 'post-earnings-research':
      return t('automation.schedule.onEarningsEvents')
  }
}

/** One automation rule card in the management drawer (spec §21–25). */
export const RuleCard: React.FC<RuleCardProps> = ({
  rule,
  lastRun,
  running,
  onToggle,
  onRun,
}) => {
  const { t } = useTranslation()
  const label = t(AUTOMATION_TYPE_KEYS[rule.type])
  return (
    <div className="rounded-[12px] border border-[oklch(var(--foreground)/0.08)] bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground">{label}</div>
          <div className="mt-0.5 text-[12px] text-foreground/54">{scheduleSummary(rule, t)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              rule.notify === 'material-only'
                ? 'bg-[var(--mac-accent)]/10 text-[var(--mac-accent)]'
                : 'bg-foreground/8 text-foreground/54'
            }`}
          >
            {rule.notify === 'material-only'
              ? t('automation.notify.materialOnly')
              : t('automation.notify.allChanges')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={`${label} ${rule.enabled ? t('automation.enabled') : t('automation.disabled')}`}
            onClick={() => onToggle(rule)}
            className={`h-5 w-9 rounded-full transition-colors ${
              rule.enabled ? 'bg-[var(--mac-accent)]' : 'bg-foreground/15'
            }`}
          >
            <span
              className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="text-[11px] text-foreground/38">
          {lastRun !== undefined
            ? t('automation.run.lastRun', {
                when: formatWhen(lastRun.ranAt, t),
                evaluated: lastRun.evaluated,
                material: lastRun.materialChanges,
              })
            : t('automation.run.noRunsYet')}
        </div>
        <button
          type="button"
          onClick={() => onRun(rule.id)}
          disabled={running || !rule.enabled}
          className="rounded-[8px] border border-[oklch(var(--foreground)/0.12)] px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-[var(--mac-border-strong)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {running ? t('automation.run.running') : t('automation.run.runNow')}
        </button>
      </div>
    </div>
  )
}

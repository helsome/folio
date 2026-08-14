import type { AutomationRule, AutomationType } from '@finagent/core'

/**
 * Pure scheduling for the five fixed automations (spec §21–25).
 *
 * Cadence by type — all wall-clock times are LOCAL (the app is a local
 * desktop product; "after market close" means the user's evening):
 *
 *   - watchlist-daily-review / portfolio-daily-brief: after market close,
 *     default 16:30 local on weekdays. `rule.hour` may override the time
 *     (16.5 = 16:30, integer hours allowed); `rule.days` may override the
 *     weekday set. Empty days → Mon–Fri.
 *   - weekly-thesis-review: Sundays 09:00.
 *   - pre/post-earnings-research: EVENT-DRIVEN — no wall-clock schedule.
 *     `nextRunAt` returns null and `runDue` never fires; the earnings-event
 *     hook (wired by the kernel host) calls `runAutomation` directly with
 *     the symbols that have calendar events.
 *
 * Everything here is pure and deterministic: `now` is injected epoch-ms.
 */

const DAY_MS = 86_400_000

/** Default daily-brief cadence: weekdays only (0=Sun … 6=Sat). */
export const WEEKDAYS = [1, 2, 3, 4, 5] as const

/** Default after-market-close time for daily briefs (16:30 local). */
export const DEFAULT_BRIEF_HOUR = 16.5

/** Weekly thesis review cadence: Sunday 09:00. */
export const THESIS_REVIEW_DAY = 0
export const THESIS_REVIEW_HOUR = 9

/** Days scanned forward by `nextRunAt` — covers Fri→Mon for daily briefs. */
const SCAN_DAYS = 8

/** True when the rule type is wall-clock scheduled (vs event-driven). */
export function isScheduledType(type: AutomationType): boolean {
  return type !== 'pre-earnings-research' && type !== 'post-earnings-research'
}

/** Scheduled days-of-week for a rule; empty when the type is event-driven. */
export function daysFor(rule: AutomationRule): number[] {
  if (rule.days !== undefined && rule.days.length > 0) return rule.days
  switch (rule.type) {
    case 'weekly-thesis-review':
      return [THESIS_REVIEW_DAY]
    case 'watchlist-daily-review':
    case 'portfolio-daily-brief':
      return [...WEEKDAYS]
    default:
      return []
  }
}

/** Scheduled clock time for a rule (event-driven types report 00:00). */
export function scheduleFor(rule: AutomationRule): { hour: number; minute: number } {
  switch (rule.type) {
    case 'weekly-thesis-review':
      return { hour: THESIS_REVIEW_HOUR, minute: 0 }
    case 'watchlist-daily-review':
    case 'portfolio-daily-brief': {
      const decimal = rule.hour ?? DEFAULT_BRIEF_HOUR
      const hour = Math.floor(decimal)
      const minute = Math.round((decimal - hour) * 60)
      return { hour, minute }
    }
    default:
      return { hour: 0, minute: 0 }
  }
}

/**
 * The scheduled occurrence (epoch-ms) for a rule on the calendar day
 * containing `day`, or null when that day is not in the rule's day set.
 */
export function occurrenceOn(rule: AutomationRule, day: number): number | null {
  const days = daysFor(rule)
  const dow = new Date(day).getDay()
  if (!days.includes(dow)) return null
  const time = scheduleFor(rule)
  const date = new Date(day)
  date.setHours(time.hour, time.minute, 0, 0)
  return date.getTime()
}

/**
 * The next wall-clock occurrence at or after `now`, or null for event-driven
 * rules (their run is triggered by the earnings-event hook instead).
 */
export function nextRunAt(rule: AutomationRule, now: number = Date.now()): number | null {
  if (!isScheduledType(rule.type)) return null
  for (let i = 0; i < SCAN_DAYS; i += 1) {
    const candidate = occurrenceOn(rule, now + i * DAY_MS)
    if (candidate !== null && candidate >= now) return candidate
  }
  return null
}

/** True when today's occurrence exists and has already arrived. */
export function isDueAt(rule: AutomationRule, now: number = Date.now()): boolean {
  if (!isScheduledType(rule.type)) return false
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const occurrence = occurrenceOn(rule, startOfDay.getTime())
  return occurrence !== null && occurrence <= now
}

/** Enabled rules whose scheduled occurrence has arrived (daily dedupe). */
export function runDue(rules: AutomationRule[], now: number = Date.now()): AutomationRule[] {
  return rules.filter((rule) => rule.enabled && isDueAt(rule, now))
}

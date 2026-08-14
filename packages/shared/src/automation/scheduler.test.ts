import { describe, expect, it } from 'bun:test'
import type { AutomationRule } from '@finagent/core'
import {
  DEFAULT_BRIEF_HOUR,
  isDueAt,
  isScheduledType,
  nextRunAt,
  occurrenceOn,
  runDue,
  scheduleFor,
} from './scheduler.ts'

/** Local-noon epoch ms for a calendar date (avoid DST edge weirdness). */
function noon(date: string): number {
  return new Date(`${date}T12:00:00`).getTime()
}

function local(date: string, hour: number, minute = 0): number {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).getTime()
}

function rule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: 'rule-1',
    type: 'watchlist-daily-review',
    enabled: true,
    notify: 'material-only',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('scheduler scheduleFor', () => {
  it('defaults daily briefs to 16:30 local', () => {
    expect(scheduleFor(rule({}))).toEqual({ hour: 16, minute: 30 })
    expect(scheduleFor(rule({ type: 'portfolio-daily-brief' }))).toEqual({ hour: 16, minute: 30 })
  })

  it('honors an explicit hour and fractional hours', () => {
    expect(scheduleFor(rule({ hour: 9 }))).toEqual({ hour: 9, minute: 0 })
    expect(scheduleFor(rule({ hour: DEFAULT_BRIEF_HOUR }))).toEqual({ hour: 16, minute: 30 })
    expect(scheduleFor(rule({ hour: 8.25 }))).toEqual({ hour: 8, minute: 15 })
  })

  it('pins weekly thesis review to Sunday 09:00', () => {
    expect(scheduleFor(rule({ type: 'weekly-thesis-review' }))).toEqual({ hour: 9, minute: 0 })
  })
})

describe('scheduler nextRunAt', () => {
  it('returns today after-market-close when still ahead of the schedule', () => {
    const now = local('2026-08-10', 10, 0) // Monday 10:00
    expect(nextRunAt(rule({}), now)).toBe(local('2026-08-10', 16, 30))
  })

  it('rolls to the next weekday once today’s slot has passed', () => {
    const now = local('2026-08-10', 17, 0) // Monday 17:00
    expect(nextRunAt(rule({}), now)).toBe(local('2026-08-11', 16, 30))
  })

  it('skips weekends for the weekday default', () => {
    const friday = local('2026-08-14', 17, 0)
    expect(nextRunAt(rule({}), friday)).toBe(local('2026-08-17', 16, 30))

    const sunday = local('2026-08-09', 10, 0)
    expect(nextRunAt(rule({}), sunday)).toBe(local('2026-08-10', 16, 30))
  })

  it('returns the slot itself when now equals the occurrence', () => {
    const now = local('2026-08-10', 16, 30)
    expect(nextRunAt(rule({}), now)).toBe(now)
  })

  it('honors custom days and hour overrides', () => {
    const weekendOnly = rule({ days: [0, 6], hour: 9 })
    expect(nextRunAt(weekendOnly, local('2026-08-14', 10, 0))).toBe(local('2026-08-15', 9, 0))
    expect(nextRunAt(weekendOnly, local('2026-08-15', 10, 0))).toBe(local('2026-08-16', 9, 0))
  })

  it('schedules weekly thesis review for the next Sunday 09:00', () => {
    const thesis = rule({ type: 'weekly-thesis-review' })
    expect(nextRunAt(thesis, local('2026-08-14', 10, 0))).toBe(local('2026-08-16', 9, 0))
    expect(nextRunAt(thesis, local('2026-08-16', 8, 0))).toBe(local('2026-08-16', 9, 0))
    expect(nextRunAt(thesis, local('2026-08-16', 10, 0))).toBe(local('2026-08-23', 9, 0))
  })

  it('returns null for event-driven earnings rules', () => {
    const pre = rule({ type: 'pre-earnings-research' })
    const post = rule({ type: 'post-earnings-research' })
    expect(isScheduledType(pre.type)).toBe(false)
    expect(nextRunAt(pre, noon('2026-08-10'))).toBeNull()
    expect(nextRunAt(post, noon('2026-08-10'))).toBeNull()
  })
})

describe('scheduler runDue / isDueAt', () => {
  it('is due after today’s occurrence has arrived', () => {
    const daily = rule({})
    expect(isDueAt(daily, local('2026-08-10', 16, 30))).toBe(true)
    expect(isDueAt(daily, local('2026-08-10', 17, 0))).toBe(true)
    expect(isDueAt(daily, local('2026-08-10', 10, 0))).toBe(false)
  })

  it('is never due on non-scheduled days', () => {
    const daily = rule({})
    expect(isDueAt(daily, local('2026-08-15', 17, 0))).toBe(false) // Saturday
    const thesis = rule({ type: 'weekly-thesis-review' })
    expect(isDueAt(thesis, local('2026-08-10', 10, 0))).toBe(false) // Monday
    expect(isDueAt(thesis, local('2026-08-16', 9, 0))).toBe(true) // Sunday 09:00
  })

  it('filters to enabled rules only', () => {
    const due = rule({})
    const disabled = rule({ id: 'rule-2', enabled: false })
    const earnings = rule({ id: 'rule-3', type: 'pre-earnings-research' })
    const now = local('2026-08-10', 17, 0)
    expect(runDue([due, disabled, earnings], now)).toEqual([due])
  })

  it('returns each daily rule at most once per day (dedupe)', () => {
    const now = local('2026-08-10', 17, 0)
    expect(runDue([rule({}), rule({})], now)).toHaveLength(2)
    expect(runDue([rule({ id: 'a' }), rule({ id: 'b' })], now).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('occurrenceOn matches the day set', () => {
    const daily = rule({})
    expect(occurrenceOn(daily, noon('2026-08-10'))).toBe(local('2026-08-10', 16, 30))
    expect(occurrenceOn(daily, noon('2026-08-15'))).toBeNull()
  })
})

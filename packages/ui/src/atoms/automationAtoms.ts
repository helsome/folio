import { atom } from 'jotai'
import type { AutomationRule, AutomationRun, AutomationType } from '@finagent/core'
import type { FinagentClient } from '../client'
import {
  loadAutomationRules,
  loadAutomationRuns,
  loadDailyBrief,
  removeAutomationRule,
  runAutomationRule,
  saveAutomationRule,
  type DailyBrief,
} from '../client/automation'

/**
 * Automation view state (spec §21–25): the five fixed rules, their recent
 * runs, and the on-demand Daily Brief. Every loader is defensive — when the
 * IPC channel is missing the state degrades to empty/null instead of
 * throwing, matching the alerts pattern.
 */

export interface AutomationState {
  rules: AutomationRule[]
  runs: AutomationRun[]
  brief: DailyBrief | null
  rulesLoading: boolean
  briefLoading: boolean
  error: string | null
}

export const automationStateAtom = atom<AutomationState>({
  rules: [],
  runs: [],
  brief: null,
  rulesLoading: false,
  briefLoading: false,
  error: null,
})

/** Load rules + recent runs into the shared state atom. */
export const loadAutomationRulesAtom = atom(null, async (_get, set, client: FinagentClient) => {
  set(automationStateAtom, (state) => ({ ...state, rulesLoading: true, error: null }))
  try {
    const [rules, runs] = await Promise.all([
      loadAutomationRules(client),
      loadAutomationRuns(client),
    ])
    set(automationStateAtom, (state) => ({
      ...state,
      rules,
      runs,
      rulesLoading: false,
      error: null,
    }))
  } catch (error) {
    set(automationStateAtom, (state) => ({
      ...state,
      rulesLoading: false,
      error: error instanceof Error ? error.message : 'Failed to load automation',
    }))
  }
})

/** Rebuild the Daily Brief on demand (refresh button). */
export const loadBriefAtom = atom(null, async (_get, set, client: FinagentClient) => {
  set(automationStateAtom, (state) => ({ ...state, briefLoading: true, error: null }))
  try {
    const brief = await loadDailyBrief(client)
    set(automationStateAtom, (state) => ({ ...state, brief, briefLoading: false, error: null }))
  } catch (error) {
    set(automationStateAtom, (state) => ({
      ...state,
      briefLoading: false,
      error: error instanceof Error ? error.message : 'Failed to build brief',
    }))
  }
})

/** Optimistic enable/disable toggle, persisted through the channel. */
export const toggleAutomationRuleAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; rule: AutomationRule }) => {
    const updated = { ...input.rule, enabled: !input.rule.enabled }
    set(automationStateAtom, (state) => ({
      ...state,
      rules: state.rules.map((rule) => (rule.id === updated.id ? updated : rule)),
    }))
    await saveAutomationRule(input.client, updated)
  }
)

export const removeAutomationRuleAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; ruleId: string }) => {
    set(automationStateAtom, (state) => ({
      ...state,
      rules: state.rules.filter((rule) => rule.id !== input.ruleId),
    }))
    await removeAutomationRule(input.client, input.ruleId)
  }
)

/** Run a rule now; the recorded run is prepended to the runs list. */
export const runRuleAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; ruleId: string }) => {
    const run = await runAutomationRule(input.client, input.ruleId)
    if (run !== null) {
      set(automationStateAtom, (state) => ({
        ...state,
        runs: [run, ...state.runs.filter((existing) => existing.id !== run.id)],
      }))
    }
    return run
  }
)

// ── Renderer mirrors for display (keep in sync with shared scheduler) ──────

export const AUTOMATION_TYPE_LABELS: Record<AutomationType, string> = {
  'watchlist-daily-review': 'Watchlist daily review',
  'portfolio-daily-brief': 'Portfolio daily brief',
  'weekly-thesis-review': 'Weekly thesis review',
  'pre-earnings-research': 'Pre-earnings research',
  'post-earnings-research': 'Post-earnings research',
}

export const AUTOMATION_TYPE_ORDER: readonly AutomationType[] = [
  'watchlist-daily-review',
  'portfolio-daily-brief',
  'weekly-thesis-review',
  'pre-earnings-research',
  'post-earnings-research',
]

const WEEKDAYS = [1, 2, 3, 4, 5]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function daySummary(days: number[]): string {
  if (days.length === 0) return ''
  if (days.length === 7) return 'Daily'
  if (days.length === 5 && WEEKDAYS.every((day) => days.includes(day))) return 'Weekdays'
  return days.map((day) => DAY_NAMES[day] ?? day).join(', ')
}

/** Human-readable schedule line for a rule card (pure). */
export function ruleScheduleSummary(rule: AutomationRule): string {
  switch (rule.type) {
    case 'watchlist-daily-review':
    case 'portfolio-daily-brief': {
      const decimal = rule.hour ?? 16.5
      const hour = Math.floor(decimal)
      const minute = Math.round((decimal - hour) * 60)
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      const days = rule.days !== undefined && rule.days.length > 0 ? rule.days : WEEKDAYS
      return `${daySummary(days)} ${time}`
    }
    case 'weekly-thesis-review':
      return 'Sundays 09:00'
    case 'pre-earnings-research':
    case 'post-earnings-research':
      return 'On earnings events'
  }
}

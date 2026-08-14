import type { AutomationRule, AutomationRun, ApiResult } from '@finagent/core'
import type { FinagentClient } from '../client'

/**
 * Renderer-facing mirror of the automation domain
 * (`@finagent/shared/automation` — node/executor code, never imported here;
 * see the diagnostics mirror for the same convention).
 *
 * The main process owns the canonical shapes (`rules-repository.ts`,
 * `brief.ts` in packages/shared); keep these two in sync.
 */

export type BriefItemSource = 'Portfolio' | 'Watchlist' | 'Thesis' | 'Alert' | 'Automation'

export type BriefSeverity = 'info' | 'warning' | 'critical'

export interface BriefItem {
  id: string
  symbol?: string
  title: string
  message: string
  source: BriefItemSource
  severity: BriefSeverity
  /** Structured explainability payload for "Why am I seeing this?". */
  payload?: Record<string, unknown>
}

export interface DailyBrief {
  generatedAt: number
  items: BriefItem[]
  /** "N things need your attention" summary. */
  summary: string
  /** Monitored securities that stayed below the materiality bar. */
  quiet: { count: number; message: string }
}

/** The automation IPC surface (wired by the Lead at integration). */
export interface AutomationChannel {
  listRules: () => Promise<ApiResult<AutomationRule[]>>
  saveRule: (rule: AutomationRule) => Promise<ApiResult<AutomationRule>>
  removeRule: (ruleId: string) => Promise<ApiResult<void>>
  runRule: (input: { ruleId: string }) => Promise<ApiResult<AutomationRun>>
  listRuns: () => Promise<ApiResult<AutomationRun[]>>
  buildBrief: () => Promise<ApiResult<DailyBrief>>
}

const EMPTY_RULES: readonly AutomationRule[] = []
const EMPTY_RUNS: readonly AutomationRun[] = []

function channel(client: FinagentClient): Partial<AutomationChannel> {
  const automation = (client as { automation?: Partial<AutomationChannel> }).automation
  return automation ?? {}
}

/** Load rules; [] when the channel is absent or fails. */
export async function loadAutomationRules(client: FinagentClient): Promise<AutomationRule[]> {
  const listRules = channel(client).listRules
  if (typeof listRules !== 'function') return [...EMPTY_RULES]
  try {
    const result = await listRules()
    return result.ok ? (result.data ?? [...EMPTY_RULES]) : [...EMPTY_RULES]
  } catch {
    return [...EMPTY_RULES]
  }
}

/** Load recent runs; [] when the channel is absent or fails. */
export async function loadAutomationRuns(client: FinagentClient): Promise<AutomationRun[]> {
  const listRuns = channel(client).listRuns
  if (typeof listRuns !== 'function') return [...EMPTY_RUNS]
  try {
    const result = await listRuns()
    return result.ok ? (result.data ?? [...EMPTY_RUNS]) : [...EMPTY_RUNS]
  } catch {
    return [...EMPTY_RUNS]
  }
}

/** Persist a rule (toggle/edit); false when the channel is absent or fails. */
export async function saveAutomationRule(client: FinagentClient, rule: AutomationRule): Promise<boolean> {
  const saveRule = channel(client).saveRule
  if (typeof saveRule !== 'function') return false
  try {
    const result = await saveRule(rule)
    return result.ok
  } catch {
    return false
  }
}

/** Remove a rule; false when the channel is absent or fails. */
export async function removeAutomationRule(client: FinagentClient, ruleId: string): Promise<boolean> {
  const removeRule = channel(client).removeRule
  if (typeof removeRule !== 'function') return false
  try {
    const result = await removeRule(ruleId)
    return result.ok
  } catch {
    return false
  }
}

/** Run a rule on demand; null when the channel is absent or fails. */
export async function runAutomationRule(
  client: FinagentClient,
  ruleId: string
): Promise<AutomationRun | null> {
  const runRule = channel(client).runRule
  if (typeof runRule !== 'function') return null
  try {
    const result = await runRule({ ruleId })
    return result.ok ? (result.data ?? null) : null
  } catch {
    return null
  }
}

/** Build the Daily Brief; null when the channel is absent or fails. */
export async function loadDailyBrief(client: FinagentClient): Promise<DailyBrief | null> {
  const buildBrief = channel(client).buildBrief
  if (typeof buildBrief !== 'function') return null
  try {
    const result = await buildBrief()
    return result.ok ? (result.data ?? null) : null
  } catch {
    return null
  }
}

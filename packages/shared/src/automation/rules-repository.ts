import type { AutomationRule, AutomationRun } from '@finagent/core'
import { resolve } from 'node:path'
import type { JsonFileStore } from '../storage/json-file-store.ts'
import { withWriteLock } from '../storage/write-lock.ts'

/**
 * Automation persistence (spec §21–25). Two files under the injected
 * JsonFileStore root (kernel host → `userData`), matching the
 * research-diff / outcome repository pattern:
 *
 *   automations.json     — AutomationRule[] (five fixed rules; no cron UI)
 *   automation-runs.json — completed runs plus claimed scheduled occurrences
 *
 * The repository is deliberately thin: seeding the five default rules is the
 * kernel host's job (first run), the UI only toggles `enabled` / runs a rule,
 * and every execution is appended as an `AutomationRun`.
 */

const RULES_FILE = 'automations.json'
const RUNS_FILE = 'automation-runs.json'

interface RunsFile {
  runs: AutomationRun[]
  /** Scheduled occurrences claimed before execution, grouped by rule id. */
  scheduledOccurrences?: Record<string, string[]>
}

export class AutomationRuleRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    // Lock the full read-modify-write cycle, including across store instances.
    const path = resolve(this.store.resolve(RULES_FILE))
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    return withWriteLock(key, operation)
  }

  async list(): Promise<AutomationRule[]> {
    return this.store.read<AutomationRule[]>(RULES_FILE, [])
  }

  async get(id: string): Promise<AutomationRule | undefined> {
    const rules = await this.list()
    return rules.find((rule) => rule.id === id)
  }

  /** Upsert a rule by id — first-run seeding and UI edits share this path. */
  async save(rule: AutomationRule): Promise<AutomationRule> {
    return this.mutate(async () => {
      const rules = await this.list()
      const index = rules.findIndex((existing) => existing.id === rule.id)
      const next = [...rules]
      if (index >= 0) {
        next[index] = rule
      } else {
        next.push(rule)
      }
      await this.store.write(RULES_FILE, next)
      return rule
    })
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async () => {
      const rules = await this.list()
      await this.store.write(
        RULES_FILE,
        rules.filter((rule) => rule.id !== id)
      )
    })
  }

  /** Flip the enabled flag; returns the updated rule, or null when unknown. */
  async enable(id: string, enabled: boolean): Promise<AutomationRule | null> {
    return this.mutate(async () => {
      const rules = await this.list()
      const index = rules.findIndex((rule) => rule.id === id)
      if (index < 0) return null
      const updated = { ...rules[index], enabled }
      const next = [...rules]
      next[index] = updated
      await this.store.write(RULES_FILE, next)
      return updated
    })
  }
}

export class AutomationRunRepository {
  // Share the entire read-modify-write queue across instances for each file.
  // JsonFileStore's atomic rename cannot prevent stale snapshot overwrites.
  private static readonly mutations = new Map<string, Promise<void>>()
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  private async read(): Promise<RunsFile> {
    return this.store.read<RunsFile>(RUNS_FILE, { runs: [] })
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const path = resolve(this.store.resolve(RUNS_FILE))
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const previous = AutomationRunRepository.mutations.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    // Preserve this caller's error without poisoning subsequent mutations.
    const settled = result.then(() => undefined, () => undefined)
    AutomationRunRepository.mutations.set(key, settled)
    try {
      return await result
    } finally {
      if (AutomationRunRepository.mutations.get(key) === settled) {
        AutomationRunRepository.mutations.delete(key)
      }
    }
  }

  /** Append a run (upsert by id); the list stays sorted newest-first. */
  async record(run: AutomationRun): Promise<void> {
    await this.mutate(async () => {
      const file = await this.read()
      const next = [run, ...file.runs.filter((existing) => existing.id !== run.id)]
      next.sort((a, b) => b.ranAt - a.ranAt || a.id.localeCompare(b.id))
      await this.store.write(RUNS_FILE, { ...file, runs: next })
    })
  }

  /**
   * Persistently claim one scheduled occurrence. A claim is made before the
   * rule starts, so another scheduler tick (or a restarted host) cannot run
   * the same occurrence again.
   */
  async claimScheduledOccurrence(ruleId: string, occurrence: string): Promise<boolean> {
    return this.mutate(async () => {
      const file = await this.read()
      const occurrences = file.scheduledOccurrences?.[ruleId] ?? []
      if (occurrences.includes(occurrence)) return false
      await this.store.write(RUNS_FILE, {
        ...file,
        scheduledOccurrences: {
          ...file.scheduledOccurrences,
          [ruleId]: [...occurrences, occurrence],
        },
      })
      return true
    })
  }

  async list(): Promise<AutomationRun[]> {
    const file = await this.read()
    return file.runs
  }

  async listByRule(ruleId: string): Promise<AutomationRun[]> {
    const file = await this.read()
    return file.runs.filter((run) => run.ruleId === ruleId)
  }
}

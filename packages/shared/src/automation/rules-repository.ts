import type { AutomationRule, AutomationRun } from '@finagent/core'
import type { JsonFileStore } from '../storage/json-file-store.ts'

/**
 * Automation persistence (spec §21–25). Two files under the injected
 * JsonFileStore root (kernel host → `userData`), matching the
 * research-diff / outcome repository pattern:
 *
 *   automations.json     — AutomationRule[] (five fixed rules; no cron UI)
 *   automation-runs.json — { runs: AutomationRun[] } newest first
 *
 * The repository is deliberately thin: seeding the five default rules is the
 * kernel host's job (first run), the UI only toggles `enabled` / runs a rule,
 * and every execution is appended as an `AutomationRun`.
 */

const RULES_FILE = 'automations.json'
const RUNS_FILE = 'automation-runs.json'

interface RunsFile {
  runs: AutomationRun[]
}

export class AutomationRuleRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
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
  }

  async remove(id: string): Promise<void> {
    const rules = await this.list()
    await this.store.write(
      RULES_FILE,
      rules.filter((rule) => rule.id !== id)
    )
  }

  /** Flip the enabled flag; returns the updated rule, or null when unknown. */
  async enable(id: string, enabled: boolean): Promise<AutomationRule | null> {
    const rules = await this.list()
    const index = rules.findIndex((rule) => rule.id === id)
    if (index < 0) return null
    const updated = { ...rules[index], enabled }
    const next = [...rules]
    next[index] = updated
    await this.store.write(RULES_FILE, next)
    return updated
  }
}

export class AutomationRunRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  private async read(): Promise<RunsFile> {
    return this.store.read<RunsFile>(RUNS_FILE, { runs: [] })
  }

  /** Append a run (upsert by id); the list stays sorted newest-first. */
  async record(run: AutomationRun): Promise<void> {
    const file = await this.read()
    const next = [run, ...file.runs.filter((existing) => existing.id !== run.id)]
    next.sort((a, b) => b.ranAt - a.ranAt || a.id.localeCompare(b.id))
    await this.store.write(RUNS_FILE, { runs: next })
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

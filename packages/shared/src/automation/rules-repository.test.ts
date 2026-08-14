import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { AutomationRule, AutomationRun } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { AutomationRuleRepository, AutomationRunRepository } from './rules-repository.ts'

let dir = ''
let store: JsonFileStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-automation-'))
  store = new JsonFileStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function rule(id: string, overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id,
    type: 'watchlist-daily-review',
    enabled: true,
    notify: 'material-only',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function run(id: string, ruleId: string, ranAt: number): AutomationRun {
  return {
    id,
    ruleId,
    ranAt,
    evaluated: 3,
    materialChanges: 1,
    analyzed: 1,
    notified: true,
    failures: [],
  }
}

describe('AutomationRuleRepository', () => {
  it('round-trips rules across repository instances (restart)', async () => {
    await new AutomationRuleRepository(store).save(rule('r1', { strategyId: 'value' }))

    const repo = new AutomationRuleRepository(new JsonFileStore(dir))
    const rules = await repo.list()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toEqual(rule('r1', { strategyId: 'value' }))
    expect((await repo.get('r1'))?.id).toBe('r1')
    expect(await repo.get('missing')).toBeUndefined()
  })

  it('upserts by id instead of duplicating', async () => {
    const repo = new AutomationRuleRepository(store)
    await repo.save(rule('r1', { enabled: true }))
    await repo.save(rule('r1', { enabled: false }))
    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get('r1'))?.enabled).toBe(false)
  })

  it('removes a rule by id', async () => {
    const repo = new AutomationRuleRepository(store)
    await repo.save(rule('r1'))
    await repo.save(rule('r2'))
    await repo.remove('r1')
    expect((await repo.list()).map((r) => r.id)).toEqual(['r2'])
  })

  it('enables and disables rules, returning null for unknown ids', async () => {
    const repo = new AutomationRuleRepository(store)
    await repo.save(rule('r1'))
    const disabled = await repo.enable('r1', false)
    expect(disabled?.enabled).toBe(false)
    expect((await repo.get('r1'))?.enabled).toBe(false)
    expect(await repo.enable('missing', true)).toBeNull()
  })
})

describe('AutomationRunRepository', () => {
  it('records runs and lists them newest-first across restarts', async () => {
    const repo = new AutomationRunRepository(store)
    await repo.record(run('run-old', 'r1', 1_700_000_000_000))
    await repo.record(run('run-new', 'r1', 1_700_086_400_000))

    const fresh = new AutomationRunRepository(new JsonFileStore(dir))
    expect((await fresh.list()).map((r) => r.id)).toEqual(['run-new', 'run-old'])
  })

  it('upserts by run id and filters by rule', async () => {
    const repo = new AutomationRunRepository(store)
    await repo.record(run('run-1', 'r1', 1_700_000_000_000))
    await repo.record(run('run-1', 'r1', 1_700_086_400_000))
    await repo.record(run('run-2', 'r2', 1_700_000_000_000))
    expect(await repo.list()).toHaveLength(2)
    expect((await repo.listByRule('r1')).map((r) => r.id)).toEqual(['run-1'])
    expect((await repo.listByRule('r2')).map((r) => r.id)).toEqual(['run-2'])
    expect(await repo.listByRule('r3')).toEqual([])
  })
})

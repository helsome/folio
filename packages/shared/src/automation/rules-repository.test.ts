import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
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

// Freeze a real on-disk snapshot before the first mutation writes it back.
// Synchronous snapshot reads make overlapping operations deterministic: an
// unprotected second mutation sees the stale file before the first is released.
class PausedSnapshotStore extends JsonFileStore {
  private paused = false
  private signalRead!: () => void
  private releaseRead!: () => void
  readonly snapshotReady = new Promise<void>((resolve) => { this.signalRead = resolve })
  private readonly released = new Promise<void>((resolve) => { this.releaseRead = resolve })

  constructor(root: string, private readonly pauseFirstRead = false) {
    super(root)
  }

  resume(): void { this.releaseRead() }

  async read<T>(file: string, _fallback: T): Promise<T> {
    const snapshot = JSON.parse(readFileSync(this.resolve(file), 'utf8')) as T
    if (this.pauseFirstRead && !this.paused) {
      this.paused = true
      this.signalRead()
      await this.released
    }
    return snapshot
  }
}

describe('AutomationRuleRepository', () => {
  it('preserves concurrent saves of different rules across repository instances', async () => {
    await store.write('automations.json', [])
    const pausedStore = new PausedSnapshotStore(dir, true)
    const first = new AutomationRuleRepository(pausedStore)
    const second = new AutomationRuleRepository(new PausedSnapshotStore(join(dir, '.')))
    const firstSave = first.save(rule('r1'))
    await pausedStore.snapshotReady
    const secondSave = second.save(rule('r2'))
    pausedStore.resume()
    await Promise.all([firstSave, secondSave])

    const fresh = new AutomationRuleRepository(new JsonFileStore(dir))
    expect((await fresh.list()).map((entry) => entry.id).sort()).toEqual(['r1', 'r2'])
  })

  for (const operation of ['save', 'enable'] as const) {
    it('preserves concurrent toggles of different rules using ' + operation, async () => {
      await store.write('automations.json', [rule('r1'), rule('r2')])
      const pausedStore = new PausedSnapshotStore(dir, true)
      const first = new AutomationRuleRepository(pausedStore)
      const second = new AutomationRuleRepository(new PausedSnapshotStore(join(dir, '.')))
      const firstUpdate = operation === 'save'
        ? first.save(rule('r1', { enabled: false }))
        : first.enable('r1', false)
      await pausedStore.snapshotReady
      const secondUpdate = operation === 'save'
        ? second.save(rule('r2', { enabled: false }))
        : second.enable('r2', false)
      pausedStore.resume()
      await Promise.all([firstUpdate, secondUpdate])

      const fresh = new AutomationRuleRepository(new JsonFileStore(dir))
      expect(await fresh.list()).toEqual([
        rule('r1', { enabled: false }),
        rule('r2', { enabled: false }),
      ])
    })
  }

  for (const firstOperation of ['remove', 'save'] as const) {
    it('preserves removal and another rule update when ' + firstOperation + ' reads first', async () => {
      await store.write('automations.json', [rule('r1'), rule('r2')])
      const pausedStore = new PausedSnapshotStore(dir, true)
      const first = new AutomationRuleRepository(pausedStore)
      const second = new AutomationRuleRepository(new PausedSnapshotStore(join(dir, '.')))
      const firstMutation = firstOperation === 'remove'
        ? first.remove('r1')
        : first.save(rule('r2', { enabled: false }))
      await pausedStore.snapshotReady
      const secondMutation = firstOperation === 'remove'
        ? second.save(rule('r2', { enabled: false }))
        : second.remove('r1')
      pausedStore.resume()
      await Promise.all([firstMutation, secondMutation])

      const fresh = new AutomationRuleRepository(new JsonFileStore(dir))
      expect(await fresh.list()).toEqual([rule('r2', { enabled: false })])
    })
  }

  it('allows a queued rule save to succeed after an earlier write fails', async () => {
    class FailingStore extends JsonFileStore {
      async write(_file: string, _data: unknown): Promise<void> {
        throw new Error('simulated rule write failure')
      }
    }
    const first = new AutomationRuleRepository(new FailingStore(dir))
    const second = new AutomationRuleRepository(new JsonFileStore(dir))
    const results = await Promise.allSettled([
      first.save(rule('r1')),
      second.save(rule('r2')),
    ])

    expect(results[0].status).toBe('rejected')
    if (results[0].status === 'rejected') {
      expect(results[0].reason.message).toBe('simulated rule write failure')
    }
    expect(results[1].status).toBe('fulfilled')
    const fresh = new AutomationRuleRepository(new JsonFileStore(dir))
    expect(await fresh.list()).toEqual([rule('r2')])
  })

  const windowsOnly = process.platform === 'win32' ? it : it.skip
  windowsOnly('shares rule mutations across Windows path casing', async () => {
    await store.write('automations.json', [])
    const pausedStore = new PausedSnapshotStore(dir, true)
    const first = new AutomationRuleRepository(pausedStore)
    const second = new AutomationRuleRepository(new PausedSnapshotStore(dir.toUpperCase()))
    const firstSave = first.save(rule('r1'))
    await pausedStore.snapshotReady
    const secondSave = second.save(rule('r2'))
    pausedStore.resume()
    await Promise.all([firstSave, secondSave])

    const fresh = new AutomationRuleRepository(new JsonFileStore(dir))
    expect((await fresh.list()).map((entry) => entry.id).sort()).toEqual(['r1', 'r2'])
  })

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
  for (const firstOperation of ['record', 'claim'] as const) {
    it(`preserves runs and claims across instances when ${firstOperation} reads first`, async () => {
      await store.write('automation-runs.json', { runs: [] })
      const pausedStore = new PausedSnapshotStore(dir, true)
      const first = new AutomationRunRepository(pausedStore)
      const second = new AutomationRunRepository(new PausedSnapshotStore(join(dir, '.')))
      const occurrence = 'Mon Jan 01 2024'
      const firstMutation = firstOperation === 'record'
        ? first.record(run('run-a', 'r1', 1))
        : first.claimScheduledOccurrence('r2', occurrence)
      await pausedStore.snapshotReady
      const secondMutation = firstOperation === 'record'
        ? second.claimScheduledOccurrence('r2', occurrence)
        : second.record(run('run-a', 'r1', 1))
      pausedStore.resume()
      await Promise.all([firstMutation, secondMutation])

      const fresh = new AutomationRunRepository(new JsonFileStore(dir))
      expect(await fresh.list()).toEqual([run('run-a', 'r1', 1)])
      expect(await fresh.claimScheduledOccurrence('r2', occurrence)).toBe(false)
    })
  }

  it('allows only one concurrent claim for the same occurrence across instances', async () => {
    await store.write('automation-runs.json', { runs: [] })
    const pausedStore = new PausedSnapshotStore(dir, true)
    const first = new AutomationRunRepository(pausedStore)
    const second = new AutomationRunRepository(new PausedSnapshotStore(dir))
    const firstClaim = first.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')
    await pausedStore.snapshotReady
    const secondClaim = second.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')
    pausedStore.resume()
    expect(await Promise.all([firstClaim, secondClaim])).toEqual([true, false])
    const fresh = new AutomationRunRepository(new JsonFileStore(dir))
    expect(await fresh.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')).toBe(false)
  })

  it('does not block a queued record after a claim write fails', async () => {
    class FailOnceStore extends JsonFileStore {
      private failed = false
      async write(file: string, data: unknown): Promise<void> {
        if (!this.failed) {
          this.failed = true
          throw new Error('simulated write failure')
        }
        await super.write(file, data)
      }
    }
    const repo = new AutomationRunRepository(new FailOnceStore(dir))
    const results = await Promise.allSettled([
      repo.claimScheduledOccurrence('r1', 'Mon Jan 01 2024'),
      repo.record(run('run-a', 'r1', 1)),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    const fresh = new AutomationRunRepository(new JsonFileStore(dir))
    expect(await fresh.list()).toEqual([run('run-a', 'r1', 1)])
    expect(await fresh.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')).toBe(true)
  })

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

  it('claims scheduled occurrences across repository instances', async () => {
    const repo = new AutomationRunRepository(store)
    expect(await repo.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')).toBe(true)
    await repo.record(run('run-1', 'r1', 1_704_067_200_000))
    expect(await repo.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')).toBe(false)

    const fresh = new AutomationRunRepository(new JsonFileStore(dir))
    expect(await fresh.claimScheduledOccurrence('r1', 'Mon Jan 01 2024')).toBe(false)
    expect(await fresh.claimScheduledOccurrence('r1', 'Tue Jan 02 2024')).toBe(true)
    expect(await fresh.claimScheduledOccurrence('r2', 'Mon Jan 01 2024')).toBe(true)
  })

  it('persists the no-material outcome and captured portfolio scope across restarts', async () => {
    const noMaterialRun: AutomationRun = {
      ...run('run-quiet', 'portfolio-rule', 1_700_000_000_000),
      evaluated: 2,
      materialChanges: 0,
      analyzed: 0,
      notified: false,
      outcome: 'no_material_update',
      scopeSnapshot: {
        kind: 'portfolio',
        symbols: ['AAPL.US', 'MSFT.US'],
        capturedAt: 1_700_000_000_000,
        sourceFetchedAt: 1_699_999_000_000,
      },
    }
    await new AutomationRunRepository(store).record(noMaterialRun)

    const fresh = new AutomationRunRepository(new JsonFileStore(dir))

    expect(await fresh.listByRule('portfolio-rule')).toEqual([noMaterialRun])
  })
})

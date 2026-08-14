import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ScreeningRun } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { ScreeningRunRepository } from './repository.ts'

function run(id: string, strategy: ScreeningRun['strategy']): ScreeningRun {
  return {
    id,
    strategy,
    query: { limit: 5 },
    providers: ['test'],
    createdAt: 1_700_000_000_000,
    candidates: [{ symbol: 'AAPL.US', name: '', reasons: ['r'], metrics: {}, evidence: [] }],
    failures: {},
  }
}

describe('ScreeningRunRepository', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finagent-screening-repo-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips runs and lists newest first', async () => {
    const repository = new ScreeningRunRepository(new JsonFileStore(dir))
    await repository.saveRun(run('screen-1', 'top-gainers'))
    await repository.saveRun(run('screen-2', 'strong-momentum'))

    expect(await repository.getRun('screen-1')).toMatchObject({ id: 'screen-1' })
    expect(await repository.getRun('missing')).toBeUndefined()
    expect((await repository.listRuns()).map((entry) => entry.id)).toEqual(['screen-2', 'screen-1'])
  })

  it('dedupes by id on re-save', async () => {
    const repository = new ScreeningRunRepository(new JsonFileStore(dir))
    await repository.saveRun(run('screen-1', 'top-gainers'))
    await repository.saveRun(run('screen-1', 'breakout'))

    const runs = await repository.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].strategy).toBe('breakout')
  })

  it('persists to screening-runs.json under the store root', async () => {
    const repository = new ScreeningRunRepository(new JsonFileStore(dir))
    await repository.saveRun(run('screen-1', 'top-gainers'))

    const store = new JsonFileStore(dir)
    const file = await store.read<{ runs: ScreeningRun[] }>('screening-runs.json', { runs: [] })
    expect(file.runs).toHaveLength(1)
    expect(file.runs[0].id).toBe('screen-1')
  })
})

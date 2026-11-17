import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ResearchDiff } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { buildDiff, diffIdFor } from './diff-service.ts'
import { makeReport } from '../outcome/test-helpers.ts'
import { ResearchDiffRepository } from './repository.ts'

let dir = ''
let store: JsonFileStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-diff-'))
  store = new JsonFileStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function diff(id: string, symbol: string, generatedAt: number, previousReportId = 'prev'): ResearchDiff {
  return {
    id,
    symbol,
    previousReportId,
    currentReportId: id,
    generatedAt,
    changes: [],
    material: false,
    summary: 'test diff',
  }
}

describe('ResearchDiffRepository', () => {
  class SlowReadStore extends JsonFileStore {
    async read<T>(file: string, fallback: T): Promise<T> {
      const snapshot = await super.read(file, fallback)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return snapshot
    }
  }

  it('preserves concurrently built report diffs across repository instances', async () => {
    const first = buildDiff(
      makeReport({ id: 'a-before', symbol: 'AAPL.US', generatedAt: 100 }),
      makeReport({ id: 'a-after', symbol: 'AAPL.US', generatedAt: 200, risks: ['New risk'] })
    )
    const second = buildDiff(
      makeReport({ id: 'm-before', symbol: 'MSFT.US', generatedAt: 100 }),
      makeReport({ id: 'm-after', symbol: 'MSFT.US', generatedAt: 300, confidence: 0.4 })
    )
    await Promise.all([
      new ResearchDiffRepository(new SlowReadStore(dir)).save(first),
      new ResearchDiffRepository(new SlowReadStore(dir)).save(second),
    ])

    const reloaded = new ResearchDiffRepository(new JsonFileStore(dir))
    expect(await reloaded.list()).toEqual([second, first])
    expect(await reloaded.getBySymbol('aapl.us')).toEqual(first)
    expect(await reloaded.getBySymbol('MSFT.US')).toEqual(second)
  })

  it('keeps same-symbol history and newest lookup after concurrent saves', async () => {
    const repo = new ResearchDiffRepository(new SlowReadStore(dir))
    const older = diff('older', 'AAPL.US', 100)
    const newer = diff('newer', 'AAPL.US', 200)
    // The older save arrives last; timestamp ordering must still win.
    await Promise.all([repo.save(newer), repo.save(older)])
    expect(await repo.list()).toEqual([newer, older])
    expect(await repo.getBySymbol('AAPL.US')).toEqual(newer)
  })

  it('allows a queued save to continue after an earlier write fails', async () => {
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
    const repo = new ResearchDiffRepository(new FailOnceStore(dir))
    const kept = diff('kept', 'MSFT.US', 200)
    const results = await Promise.allSettled([
      repo.save(diff('failed', 'AAPL.US', 100)), repo.save(kept),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(await new ResearchDiffRepository(store).list()).toEqual([kept])
  })

  it('round-trips a diff across repository instances (restart)', async () => {
    const saved = diff('d1', 'NVDA.US', 1_700_000_000_000)
    await new ResearchDiffRepository(store).save(saved)

    const repo = new ResearchDiffRepository(new JsonFileStore(dir))
    expect(await repo.get('d1')).toEqual(saved)
    expect(await repo.get('missing')).toBeUndefined()
  })

  it('returns the latest diff per symbol', async () => {
    const repo = new ResearchDiffRepository(store)
    await repo.save(diff('d-old', 'NVDA.US', 1_700_000_000_000))
    await repo.save(diff('d-new', 'NVDA.US', 1_700_086_400_000))
    await repo.save(diff('d-aaple', 'AAPL.US', 1_700_086_400_000))

    const latest = await repo.getBySymbol('NVDA.US')
    expect(latest?.id).toBe('d-new')
    expect((await repo.getBySymbol('nvda.us'))?.id).toBe('d-new')
    expect((await repo.getBySymbol('AAPL.US'))?.id).toBe('d-aaple')
    expect(await repo.getBySymbol('MSFT.US')).toBeUndefined()
  })

  it('upserts by id instead of duplicating', async () => {
    const repo = new ResearchDiffRepository(store)
    await repo.save(diff('d1', 'NVDA.US', 1_700_000_000_000))
    await repo.save(diff('d1', 'NVDA.US', 1_700_086_400_000))
    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get('d1'))?.generatedAt).toBe(1_700_086_400_000)
  })

  it('persists a full diff with changes and thesisImpact', async () => {
    const full: ResearchDiff = {
      ...diff('d-full', 'NVDA.US', 1_700_000_000_000),
      material: true,
      changes: [
        {
          category: 'valuation',
          label: 'Verdict',
          before: 'positive',
          after: 'negative',
          direction: 'worsened',
          material: true,
          evidence: ['capability:company.valuation run:r1 fetchedAt:1700000000000'],
        },
      ],
      thesisImpact: { direction: 'invalidated', summary: 'verdict flipped' },
    }
    const repo = new ResearchDiffRepository(store)
    await repo.save(full)
    expect(await repo.get('d-full')).toEqual(full)
  })

  it('keeps the stable id derivable from the report pair', () => {
    expect(diffIdFor('report-a', 'report-b')).toBe(diffIdFor('report-a', 'report-b'))
    expect(diffIdFor('report-a', 'report-b')).not.toBe(diffIdFor('report-b', 'report-a'))
  })
})

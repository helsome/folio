import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ResearchDiff } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { diffIdFor } from './diff-service.ts'
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

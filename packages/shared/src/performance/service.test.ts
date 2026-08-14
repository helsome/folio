import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ResearchOpinion, ResearchOutcome } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { OutcomeRepository } from '../outcome/repository.ts'
import { PerformanceService } from './service.ts'

let dir = ''
let repository: OutcomeRepository
let service: PerformanceService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-performance-'))
  repository = new OutcomeRepository(new JsonFileStore(dir))
  service = new PerformanceService(repository)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function opinion(id: string, overrides: Partial<ResearchOpinion> = {}): ResearchOpinion {
  return {
    id,
    reportId: `report-${id}`,
    symbol: 'AAPL.US',
    skillIds: ['market-analysis'],
    stance: 'bullish',
    confidence: 0.8,
    horizon: '1m',
    createdAt: 1_800_000_000_000,
    evidenceRefs: [],
    ...overrides,
  }
}

function outcome(opinionId: string, overrides: Partial<ResearchOutcome> = {}): ResearchOutcome {
  return {
    id: `outcome-${opinionId}`,
    opinionId,
    horizon: '1m',
    evaluatedAt: 1_800_100_000_000,
    returnPercent: 2,
    directionCorrect: true,
    status: 'evaluated',
    outcomeEngineVersion: '1.0.0',
    ...overrides,
  }
}

describe('PerformanceService round-trip', () => {
  it('aggregates skill + strategy performance from the repository', async () => {
    await repository.saveOpinion(opinion('a', { skillIds: ['technical'], strategyId: 'technical' }))
    await repository.saveOpinion(opinion('b', { skillIds: ['technical'], strategyId: 'technical' }))
    await repository.saveOpinion(opinion('c', { skillIds: ['value'], strategyId: 'value' }))
    await repository.saveOutcome(outcome('a', { returnPercent: 4, directionCorrect: true }))
    await repository.saveOutcome(outcome('b', { returnPercent: -2, directionCorrect: false }))
    await repository.saveOutcome(outcome('c', { returnPercent: 6, directionCorrect: true }))

    const skills = await service.skillPerformance('1m')
    const strategies = await service.strategyPerformance('1m')

    expect(skills).toHaveLength(2)
    const technical = skills.find((s) => s.skillId === 'technical')
    expect(technical).toMatchObject({ samples: 2, insufficientData: true })
    expect(technical?.directionHitRate).toBeCloseTo(0.5)
    expect(technical?.avgReturn).toBeCloseTo(1)

    const strategiesBy = Object.fromEntries(strategies.map((s) => [s.strategyId, s]))
    expect(strategiesBy.technical).toMatchObject({ samples: 2, insufficientData: true })
    expect(strategiesBy.technical?.hitRate).toBeCloseTo(0.5)
    expect(strategiesBy.value).toMatchObject({ samples: 1, insufficientData: true })
    expect(strategiesBy.value?.hitRate).toBeCloseTo(1)
  })

  it('returns empty arrays when the repository has no data for the horizon', async () => {
    await repository.saveOpinion(opinion('a', { horizon: '1w', skillIds: ['technical'] }))
    await repository.saveOutcome(outcome('a', { horizon: '1w' }))

    expect(await service.skillPerformance('3m')).toEqual([])
    expect(await service.strategyPerformance('3m')).toEqual([])
    expect(await service.skillPerformance('1w')).toHaveLength(1)
  })

  it('reads opinions and outcomes in one pass per call (empty repo is NaN-safe)', async () => {
    expect(await service.skillPerformance('1m')).toEqual([])
    expect(await service.strategyPerformance('1m')).toEqual([])
  })
})

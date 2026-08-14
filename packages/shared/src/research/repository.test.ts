import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ResearchReport, ResearchRunSummary } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchReportRepository } from './repository.ts';

let dir = '';
let store: JsonFileStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-research-'));
  store = new JsonFileStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function report(id: string, symbol: string, generatedAt = 1_700_000_000_000): ResearchReport {
  return {
    id,
    symbol,
    generatedAt,
    summary: 'summary',
    stance: 'neutral',
    confidence: 0.5,
    sections: [],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'completed',
  };
}

function runSummary(id: string, symbol: string): ResearchRunSummary {
  return {
    id,
    symbol,
    status: 'completed',
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_500,
    reportId: `report-${id}`,
    plannedCapabilities: ['market.quote'],
    completedCapabilities: ['market.quote'],
    failedCapabilities: [],
  };
}

describe('ResearchReportRepository', () => {
  it('persists reports across repository instances (restart)', async () => {
    const first = new ResearchReportRepository(store);
    await first.saveReport(report('r1', 'NVDA.US'));

    const second = new ResearchReportRepository(new JsonFileStore(dir));
    expect(await second.getReport('r1')).toMatchObject({ id: 'r1', symbol: 'NVDA.US' });
  });

  it('lists reports per symbol', async () => {
    const repo = new ResearchReportRepository(store);
    await repo.saveReport(report('r1', 'NVDA.US'));
    await repo.saveReport(report('r2', 'NVDA.US'));
    await repo.saveReport(report('r3', 'AAPL.US'));

    const nvda = await repo.listBySymbol('NVDA.US');
    expect(nvda.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect((await repo.listSummaries())).toHaveLength(3);
  });

  it('returns undefined for a missing report', async () => {
    const repo = new ResearchReportRepository(store);
    expect(await repo.getReport('nope')).toBeUndefined();
  });

  it('persists and lists run summaries', async () => {
    const first = new ResearchReportRepository(store);
    await first.saveRunSummary(runSummary('run-1', 'NVDA.US'));

    const second = new ResearchReportRepository(new JsonFileStore(dir));
    const runs = await second.listRunSummaries();
    expect(runs).toHaveLength(1);
    expect((await second.getRunSummary('run-1'))?.id).toBe('run-1');
  });
});

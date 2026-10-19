import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResearchReport } from '@finagent/core';
import {
  JsonFileStore, ResearchReportRepository, ResearchService, LocalResearchSynthesizer,
  ResearchDiffRepository, ThesisRepository, ThesisImpactRepository, ThesisService,
  createCapabilityRegistry, createLocalThesisEvaluator, buildDiff,
} from '@finagent/shared';

mock.module('electron', () => ({ app: {}, safeStorage: {}, Notification: {}, shell: {} }));
const { AgentKernelHost } = await import('./kernelHost');

const report = (id: string, symbol: string, generatedAt: number): ResearchReport => ({
  id, symbol, generatedAt, summary: id, stance: 'neutral', confidence: 0.5,
  sections: [], bullCase: [], bearCase: [], catalysts: [], risks: [], capabilityRuns: [], runStatus: 'completed',
});
const oldA = report('a-old', 'AAPL.US', 1000);
const newA = report('a-new', 'AAPL.US', 2000);
const onlyB = report('b-only', 'MSFT.US', 3000);
let dir: string;
let host: InstanceType<typeof AgentKernelHost>;
let reports: ResearchReportRepository;
let diffs: ResearchDiffRepository;
let theses: ThesisRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'folio-report-selection-'));
  reports = new ResearchReportRepository(new JsonFileStore(join(dir, 'store')));
  for (const item of [oldA, newA, onlyB]) await reports.saveReport(item);
  diffs = new ResearchDiffRepository(new JsonFileStore(dir));
  theses = new ThesisRepository({ storageDir: join(dir, 'thesis') });
  const registry = createCapabilityRegistry([]);
  host = Object.assign(Object.create(AgentKernelHost.prototype), {
    researchService: new ResearchService({ registry, repository: reports, synthesizer: new LocalResearchSynthesizer() }),
    diffRepository: diffs,
    thesisRepository: theses,
    thesisService: new ThesisService({ registry, repository: theses,
      impactRepository: new ThesisImpactRepository({ storageDir: join(dir, 'thesis') }),
      evaluator: createLocalThesisEvaluator(),
    }),
  });
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('selected report main-process boundary with real file repositories', () => {
  it('saves the historical report and its sourceReportId across reopening', async () => {
    const saved = await host.thesisSaveFromReport({ symbol: 'aapl.us', reportId: oldA.id });
    const reopened = new ThesisRepository({ storageDir: join(dir, 'thesis') });
    expect(await reopened.get(saved.id)).toMatchObject({ summary: oldA.summary, sourceReportId: oldA.id, symbol: oldA.symbol });
  });

  it('preserves legacy symbol-only thesis saves', async () => {
    expect(await host.thesisSaveFromReport('AAPL.US')).toMatchObject({ summary: newA.summary, sourceReportId: newA.id });
  });

  it.each(['missing', onlyB.id])('rejects an explicit missing or wrong-symbol report %s without writing', async (reportId) => {
    await expect(host.thesisSaveFromReport({ symbol: oldA.symbol, reportId })).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
    expect(await theses.list()).toEqual([]);
  });

  it.each(['', null, 42])('rejects malformed explicit report IDs (%s) without latest fallback', async (reportId) => {
    await expect(host.thesisSaveFromReport({ symbol: oldA.symbol, reportId })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await theses.list()).toEqual([]);
  });

  it('returns no diff for the earliest report even with a latest-symbol cache', async () => {
    await diffs.save(await buildDiff(oldA, newA));
    expect(await host.researchGetDiff({ symbol: oldA.symbol, reportId: oldA.id })).toBeUndefined();
    expect(await host.researchGetDiff({ symbol: onlyB.symbol, reportId: onlyB.id })).toBeUndefined();
  });

  it('uses the selected report predecessor and ignores stale cache pairs', async () => {
    const newer = report('a-newest', oldA.symbol, 4000);
    await reports.saveReport(newer);
    await diffs.save(await buildDiff(oldA, newA));
    expect(await host.researchGetDiff({ symbol: oldA.symbol, reportId: newer.id })).toMatchObject({ currentReportId: newer.id, previousReportId: newA.id });
    expect(await host.researchGetDiff({ symbol: oldA.symbol, reportId: newA.id })).toMatchObject({ currentReportId: newA.id, previousReportId: oldA.id });
    expect((await diffs.getBySymbol(oldA.symbol))?.currentReportId).toBe(newer.id);
  });

  it('never returns another symbol cache or a latest diff for an unknown selection', async () => {
    await diffs.save(await buildDiff(oldA, newA));
    expect(await host.researchGetDiff({ symbol: onlyB.symbol, reportId: newA.id })).toBeUndefined();
    expect(await host.researchGetDiff({ symbol: oldA.symbol, reportId: 'missing' })).toBeUndefined();
  });
});

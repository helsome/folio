import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { FinanceCapability, ResearchReport } from '@finagent/core';
import { defineCapability } from '../capabilities/define.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { createLocalThesisEvaluator } from './evaluator-local.ts';
import { ThesisImpactRepository, ThesisRepository } from './repository.ts';
import { ThesisService } from './service.ts';

let dir = '';
let currentNow = 1000;
const now = () => currentNow;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-thesis-'));
  currentNow = 1000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function repositories() {
  const repository = new ThesisRepository({
    storageDir: dir,
    idGen: () => 'thesis-1',
  });
  const impactRepository = new ThesisImpactRepository({
    storageDir: dir,
    idGen: () => 'impact-1',
  });
  return { repository, impactRepository };
}

function makeCap(id: string, toolName: string, data: unknown): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName,
    inputSchema: Type.Object({ symbol: Type.String() }),
    async execute() {
      return { data, provenance: { provider: 'test', fetchedAt: currentNow, stale: false }, summary: `${id} ok` };
    },
  });
}

/** Registry with financials/earnings deliberately absent to exercise `unavailable`. */
function registryFor(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'market.quote': { symbol: 'NVDA.US', changePercent: 2, lastPrice: 100 },
    'research.news': [{ id: 'n1', title: 'NVDA wins a data-center order', summary: 'Positive demand.', url: '', timestamp: 1, symbols: ['NVDA.US'] }],
    'company.ratings': { consensus: 'neutral' },
    'company.valuation': { symbol: 'NVDA.US', pe: 34.1, pb: 27.9, totalMarketValue: 5.4e12 },
    'market.kline': [],
  };
  const data = { ...defaults, ...overrides };
  return createCapabilityRegistry([
    makeCap('market.quote', 'get_quote', data['market.quote']),
    makeCap('research.news', 'get_news', data['research.news']),
    makeCap('company.ratings', 'get_ratings', data['company.ratings']),
    makeCap('company.valuation', 'get_valuation', data['company.valuation']),
    makeCap('market.kline', 'get_kline', data['market.kline']),
  ]);
}

function makeReport(): ResearchReport {
  return {
    id: 'report-1',
    symbol: 'NVDA.US',
    generatedAt: currentNow,
    summary: 'NVDA leads the AI compute build-out.',
    stance: 'bullish',
    confidence: 0.7,
    sections: [
      {
        key: 'valuation',
        title: 'Valuation',
        verdict: 'neutral',
        summary: 'Rich but supported by growth.',
        evidence: [
          { capabilityId: 'company.valuation', runId: 'run-valuation', claim: 'expensive', fetchedAt: currentNow },
        ],
      },
    ],
    bullCase: ['Data-center demand compounds'],
    bearCase: ['Valuation compresses'],
    catalysts: ['GTC product cycle'],
    risks: ['Export restrictions'],
    capabilityRuns: [{ runId: 'run-valuation', capabilityId: 'company.valuation', status: 'success' }],
    runStatus: 'completed',
  };
}

function buildService(overrides: Record<string, unknown> = {}) {
  const { repository, impactRepository } = repositories();
  const service = new ThesisService({
    registry: registryFor(overrides),
    repository,
    impactRepository,
    evaluator: createLocalThesisEvaluator(now),
    now,
  });
  return { service, repository, impactRepository };
}

describe('ThesisService', () => {
  it('persists a thesis across repository instances (restart persistence)', async () => {
    const { repository, impactRepository } = repositories();
    const service = new ThesisService({
      registry: registryFor(),
      repository,
      impactRepository,
      evaluator: createLocalThesisEvaluator(now),
      now,
    });
    const thesis = await service.saveFromReport(makeReport());

    const reopened = new ThesisRepository({ storageDir: dir });
    const loaded = await reopened.get(thesis.id);
    expect(loaded?.symbol).toBe('NVDA.US');
    expect(loaded?.summary).toBe('NVDA leads the AI compute build-out.');
    expect(loaded?.evidenceRefs).toHaveLength(1);
  });

  it('strengthens a bullish thesis when the quote moves with it', async () => {
    const { service } = buildService({ 'market.quote': { symbol: 'NVDA.US', changePercent: 7 } });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('strengthened');
    expect(impact.thesis.updatedAt).toBe(2000);
    expect(impact.thesis.lastReviewedAt).toBe(2000);
    expect(impact.evidence.map((e) => e.capabilityId)).toContain('market.quote');
  });

  it('weakens a bullish thesis when the quote moves against it', async () => {
    const { service } = buildService({ 'market.quote': { symbol: 'NVDA.US', changePercent: -7 } });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('weakened');
  });

  it('stays unchanged on a small quote move', async () => {
    const { service } = buildService({ 'market.quote': { symbol: 'NVDA.US', changePercent: 2 } });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('unchanged');
  });

  it('invalidates on a hard negative news keyword', async () => {
    const { service } = buildService({
      'research.news': [{ id: 'n1', title: 'NVDA announces layoffs', summary: 'Mass layoffs ahead.', url: '', timestamp: 1, symbols: ['NVDA.US'] }],
    });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('invalidated');
  });

  it('weakens a bullish thesis on a sell-side consensus', async () => {
    const { service } = buildService({ 'company.ratings': { consensus: 'sell' } });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('weakened');
  });

  it('stays unchanged with an explicit note when no capability data is available', async () => {
    const { repository, impactRepository } = repositories();
    const service = new ThesisService({
      registry: createCapabilityRegistry([]),
      repository,
      impactRepository,
      evaluator: createLocalThesisEvaluator(now),
      now,
    });
    await service.saveFromReport(makeReport());
    currentNow = 2000;

    const impact = await service.reEvaluate('NVDA.US');

    expect(impact.kind).toBe('unchanged');
    expect(impact.summary).toMatch(/No fresh capability data/);
    // Every planned capability reports unavailable, never silently dropped.
    expect(impact.evidence).toEqual([]);
  });

  it('persists the impact and lists it, and updates the thesis snapshot', async () => {
    const { service, repository, impactRepository } = buildService({
      'market.quote': { symbol: 'NVDA.US', changePercent: -7 },
    });
    const thesis = await service.saveFromReport(makeReport());
    currentNow = 2000;

    await service.reEvaluate('NVDA.US');

    const impacts = await service.listImpacts('NVDA.US');
    expect(impacts).toHaveLength(1);
    expect(impacts[0].kind).toBe('weakened');
    expect(impacts[0].thesisId).toBe(thesis.id);

    // Persisted impact file + refreshed thesis snapshot (updatedAt bumped).
    const persistedImpacts = await impactRepository.list(thesis.id);
    expect(persistedImpacts).toHaveLength(1);
    const refreshed = await repository.get(thesis.id);
    expect(refreshed?.updatedAt).toBe(2000);
    expect(refreshed?.lastReviewedAt).toBe(2000);
    expect(refreshed?.evidenceRefs.map((e) => e.capabilityId)).toContain('market.quote');
  });

  it('throws THESIS_NOT_FOUND when no thesis exists for the symbol', async () => {
    const { service } = buildService();
    await expect(service.reEvaluate('MISSING.US')).rejects.toMatchObject({
      code: 'THESIS_NOT_FOUND',
    });
  });

  it('updateThesis persists a user edit and bumps updatedAt', async () => {
    const { service } = buildService();
    const thesis = await service.saveFromReport(makeReport());
    currentNow = 3000;

    const edited = await service.updateThesis({ ...thesis, summary: 'Revised thesis.' });

    expect(edited.summary).toBe('Revised thesis.');
    expect(edited.updatedAt).toBe(3000);
    expect(edited.createdAt).toBe(1000);
  });
});

import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { FinanceCapability, ResearchRunSummary } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { ResearchRunner } from './runner.ts';
import { fakeCap } from './test-helpers.ts';
import { RESEARCH_CAPABILITY_PLAN } from './planner.ts';

function makeRunner(capabilities: Array<[string, Parameters<typeof fakeCap>[1]?]>) {
  const registry = createCapabilityRegistry(
    capabilities.map(([id, mode]) => fakeCap(id, mode ?? 'success'))
  );
  return new ResearchRunner({
    registry,
    synthesizer: new LocalResearchSynthesizer(),
    now: () => 1_700_000_000_000,
  });
}

function collectStatuses(): {
  statuses: string[];
  summaries: ResearchRunSummary[];
  onStatus: (summary: ResearchRunSummary) => Promise<void>;
} {
  const statuses: string[] = [];
  const summaries: ResearchRunSummary[] = [];
  const onStatus = async (summary: ResearchRunSummary) => {
    statuses.push(summary.status);
    summaries.push(summary);
  };
  return { statuses, summaries, onStatus };
}

describe('ResearchRunner', () => {
  it('completes a full run and produces an evidence-backed report', async () => {
    const runner = makeRunner(RESEARCH_CAPABILITY_PLAN.map((id) => [id, 'success' as const]));
    const { statuses, onStatus } = collectStatuses();

    const result = await runner.run({
      symbol: 'NVDA.US',
      runId: 'run-1',
      onStatus,
    });

    expect(result.report).toBeDefined();
    expect(result.summary.status).toBe('completed');
    expect(result.report!.runStatus).toBe('completed');
    expect(result.report!.sections).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);
    expect(result.report!.capabilityRuns).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);
    // The report records which locale produced it (V8 §44–46); default en-US
    // in this process.
    expect(result.report!.locale).toBe('en-US');

    // Status transitions observed.
    expect(statuses).toEqual(['fetching', 'synthesizing', 'completed']);

    // Evidence refs point at real capability run ids present in capabilityRuns.
    const runIds = new Set(result.report!.capabilityRuns.map((r) => r.runId));
    for (const section of result.report!.sections) {
      for (const ref of section.evidence) {
        expect(runIds.has(ref.runId)).toBe(true);
        expect(ref.capabilityId).toBe(section.key);
        // Every persisted report evidence ref carries an immutable source
        // snapshot; a later live retrieval cannot silently replace it.
        expect(ref.sourceSnapshots).toHaveLength(1);
        expect(ref.sourceSnapshots![0]).toMatchObject({
          schemaVersion: 'folio-source-provenance/v1',
          retrievedAt: 1_700_000_000_000,
        });
      }
    }
  });

  it('produces a partial report with explicit unavailable + failed entries', async () => {
    // company.financials registered but fails; company.earnings/company.ratings absent.
    const caps: Array<[string, 'success' | 'fail']> = [
      ['company.profile', 'success'],
      ['market.quote', 'success'],
      ['market.kline', 'success'],
      ['company.valuation', 'success'],
      ['company.financials', 'fail'],
      ['research.news', 'success'],
      ['market.capitalFlow', 'success'],
      ['portfolio.positions', 'success'],
    ];
    const runner = makeRunner(caps);
    const { onStatus } = collectStatuses();

    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-2', onStatus });

    expect(result.summary.status).toBe('partial');
    expect(result.report!.runStatus).toBe('partial');

    const runsByCapability = new Map(
      result.report!.capabilityRuns.map((r) => [r.capabilityId, r])
    );
    expect(runsByCapability.get('company.financials')!.status).toBe('failed');
    expect(runsByCapability.get('company.earnings')!.status).toBe('unavailable');
    expect(runsByCapability.get('company.ratings')!.status).toBe('unavailable');

    // Absent capabilities are never silently dropped from the report.
    expect(result.report!.capabilityRuns).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);
  });

  it('persists per-article provenance from the real research.news report assembly path', async () => {
    const news: FinanceCapability = {
      id: 'research.news', name: 'News', description: 'Controlled news source', category: 'research',
      riskLevel: 'read', auth: 'public', toolName: 'get_news', inputSchema: Type.Object({ symbol: Type.String() }),
      async execute() {
        return {
          data: [{
            id: 'article-1', title: 'Issuer result', summary: 'Revenue grew 10%.',
            url: 'https://news.example.test/result?utm_source=research', timestamp: 1_700_000_000,
            symbols: ['NVDA.US'],
          }],
          provenance: { provider: 'controlled-news', fetchedAt: 1_700_000_001_000, stale: false },
          summary: 'One issuer result.',
        };
      },
    };
    const registry = createCapabilityRegistry([
      ...RESEARCH_CAPABILITY_PLAN.filter((id) => id !== 'research.news').map((id) => fakeCap(id)),
      news,
    ]);
    const runner = new ResearchRunner({
      registry, synthesizer: new LocalResearchSynthesizer(), now: () => 1_700_000_002_000,
    });

    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-news-snapshot' });
    const snapshot = result.report!.sections.find((section) => section.key === 'research.news')!.evidence[0].sourceSnapshots![0];

    expect(snapshot).toMatchObject({
      documentId: 'article-1', canonicalUrl: 'https://news.example.test/result',
      excerpt: 'Issuer result\n\nRevenue grew 10%.',
      retrievedAt: 1_700_000_001_000,
      retrieval: { provider: 'controlled-news', method: 'capability:research.news' },
    });
  });

  it('fails when no capability succeeds', async () => {
    const runner = makeRunner([
      ['company.profile', 'fail'],
      ['market.quote', 'fail'],
    ]);
    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-3' });

    expect(result.summary.status).toBe('failed');
    expect(result.report).toBeDefined();
    expect(result.report!.runStatus).toBe('failed');
  });

  it('cancels mid-fetch when the signal aborts', async () => {
    const runner = makeRunner([
      ['company.profile', 'success'],
      ['market.quote', 'slow'],
    ]);
    const controller = new AbortController();
    const { statuses, onStatus } = collectStatuses();

    const runPromise = runner.run({
      symbol: 'NVDA.US',
      runId: 'run-4',
      signal: controller.signal,
      onStatus,
    });

    // Let the executor start the slow capability before aborting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const result = await runPromise;
    expect(result.summary.status).toBe('cancelled');
    expect(result.summary.cancelled).toBe(true);
    expect(result.report).toBeUndefined();
    expect(statuses[statuses.length - 1]).toBe('cancelled');
  });
});

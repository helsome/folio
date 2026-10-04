import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { FinanceCapability, NewsItem, ResearchRunSummary } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { ResearchReportRepository } from './repository.ts';
import { ResearchRunner } from './runner.ts';
import { fakeCap } from './test-helpers.ts';
import { RESEARCH_CAPABILITY_PLAN } from './planner.ts';
import { passagesForEvidence, relocatePassage } from './evidence-passage.ts';

const NEWS_ITEMS: NewsItem[] = [
  {
    id: 'n1',
    title: 'Acme beats guidance',
    summary: 'Acme reported revenue above guidance.',
    url: 'https://example.com/acme-q3',
    timestamp: 1_700_000_000,
    symbols: ['ACME.US'],
  },
  {
    id: 'n2',
    title: 'Acme raises outlook',
    summary: 'The outlook was raised for the full year.',
    url: 'https://example.com/acme-outlook',
    timestamp: 1_700_000_100,
    symbols: ['ACME.US'],
  },
];

/** A `research.news` capability that returns real news items, unlike `fakeCap`. */
function newsCapability(items: NewsItem[]): FinanceCapability {
  return {
    id: 'research.news',
    name: 'News',
    description: 'fake research.news returning retrievable text',
    category: 'research',
    riskLevel: 'read',
    auth: 'public',
    toolName: 'get_news',
    inputSchema: Type.Object({ symbol: Type.String() }),
    async execute() {
      return {
        data: items,
        provenance: { provider: 'test', fetchedAt: 1_700_000_000_000, stale: false },
        summary: 'ACME.US News',
      };
    },
  };
}

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

  it('records locatable source passages for text-bearing evidence', async () => {
    const registry = createCapabilityRegistry([newsCapability(NEWS_ITEMS)]);
    const runner = new ResearchRunner({
      registry,
      synthesizer: new LocalResearchSynthesizer(),
      now: () => 1_700_000_000_000,
    });

    const result = await runner.run({ symbol: 'ACME.US', runId: 'run-passages' });
    const report = result.report!;
    const passages = report.evidencePassages ?? [];

    expect(passages).toHaveLength(NEWS_ITEMS.length);

    // Passages hang off the same evidence the report already exposes, so the
    // claim → evidence → passage jump needs no extra side table.
    const newsEvidence = report.sections.find((section) => section.key === 'research.news')!
      .evidence[0];
    expect(passagesForEvidence(passages, newsEvidence).map((passage) => passage.documentId))
      .toEqual(['n1', 'n2']);
    expect(passages[0].runId).toBe(newsEvidence.runId);
    expect(passages[0].capabilityId).toBe(newsEvidence.capabilityId);

    // The location survives persistence and still resolves to the same span.
    const reloaded = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(reloaded.evidencePassages![0].location).toEqual(passages[0].location);
    expect(relocatePassage(
      reloaded.evidencePassages![0],
      'Acme beats guidance\n\nAcme reported revenue above guidance.',
    )).toEqual(passages[0].location);
  });

  it('omits passages entirely when no source carries retrievable text', async () => {
    const runner = makeRunner([['market.quote', 'success']]);
    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-no-passages' });

    // Structured data has no passage to point at; the field stays absent rather
    // than being filled with a span over Folio's own generated summary.
    expect(result.report!.evidencePassages).toBeUndefined();
  });

  it('keeps a passage jump valid after the report is persisted and reloaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'finagent-research-passages-'));
    try {
      const registry = createCapabilityRegistry([newsCapability(NEWS_ITEMS)]);
      const runner = new ResearchRunner({
        registry,
        synthesizer: new LocalResearchSynthesizer(),
        now: () => 1_700_000_000_000,
      });
      const result = await runner.run({ symbol: 'ACME.US', runId: 'run-reload' });

      await new ResearchReportRepository(new JsonFileStore(dir)).saveReport(result.report!);

      // A second store instance stands in for a fresh process reading from disk.
      const reloaded = await new ResearchReportRepository(new JsonFileStore(dir))
        .getReport('report-run-reload');
      expect(reloaded).toBeDefined();

      const evidence = reloaded!.sections.find((section) => section.key === 'research.news')!
        .evidence[0];
      const passages = passagesForEvidence(reloaded!.evidencePassages ?? [], evidence);

      expect(passages).toHaveLength(NEWS_ITEMS.length);
      expect(relocatePassage(
        passages[0],
        'Acme beats guidance\n\nAcme reported revenue above guidance.',
      )).toEqual(passages[0].location);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

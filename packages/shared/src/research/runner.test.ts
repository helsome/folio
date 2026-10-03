import { describe, expect, it } from 'bun:test';
import type { ResearchRunSummary } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { ResearchRunner } from './runner.ts';
import { fakeCap } from './test-helpers.ts';
import { RESEARCH_CAPABILITY_PLAN } from './planner.ts';
import { claimsForEvidence, evidenceForClaim, findUnbackedClaims } from './claim-evidence.ts';

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

  it('gives every claim an id and a link to the evidence it rests on', async () => {
    const runner = makeRunner(RESEARCH_CAPABILITY_PLAN.map((id) => [id, 'success' as const]));
    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-1' });
    const report = result.report!;

    // One claim per section today; the link must be walkable both ways.
    expect(report.claims).toHaveLength(report.sections.length);
    for (const claim of report.claims!) {
      const refs = evidenceForClaim(report, claim.id);
      expect(refs).toHaveLength(1);
      expect(refs[0]!.id).toBeDefined();
      expect(refs[0]!.capabilityId).toBe(claim.sectionKey);
      expect(refs[0]!.claimId).toBe(claim.id);
      expect(claimsForEvidence(report, refs[0]!.id!).map((c) => c.id)).toEqual([claim.id]);
    }

    // A clean run leaves nothing unbacked.
    expect(findUnbackedClaims(report)).toEqual([]);
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

  it('keeps the claim of a failed capability, marked as unbacked', async () => {
    const runner = makeRunner([
      ['company.profile', 'success'],
      ['market.quote', 'fail'],
    ]);
    const result = await runner.run({ symbol: 'NVDA.US', runId: 'run-5' });
    const report = result.report!;

    const unbacked = findUnbackedClaims(report);
    expect(unbacked.map((claim) => claim.sectionKey)).toContain('market.quote');
    expect(evidenceForClaim(report, 'claim:market.quote:0')).toEqual([]);
    expect(claimsForEvidence(report, 'evidence:missing')).toEqual([]);

    // The section still exists, so the gap is visible rather than dropped.
    const quote = report.sections.find((section) => section.key === 'market.quote')!;
    expect(quote.evidence).toEqual([]);
    expect(quote.summary).not.toBe('');
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

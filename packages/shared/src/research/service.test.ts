import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ResearchRunStatus } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { ResearchReportRepository } from './repository.ts';
import { ResearchService } from './service.ts';
import { fakeCap } from './test-helpers.ts';
import { RESEARCH_CAPABILITY_PLAN } from './planner.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-research-svc-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeService(capabilities: Array<[string, Parameters<typeof fakeCap>[1]?]>) {
  const registry = createCapabilityRegistry(
    capabilities.map(([id, mode]) => fakeCap(id, mode ?? 'success'))
  );
  return new ResearchService({
    registry,
    synthesizer: new LocalResearchSynthesizer(),
    repository: new ResearchReportRepository(new JsonFileStore(dir)),
    now: () => 1_700_000_000_000,
  });
}

async function waitForTerminal(
  service: ResearchService,
  runId: string
): Promise<ResearchRunStatus> {
  const terminal = new Set<ResearchRunStatus>([
    'completed',
    'partial',
    'failed',
    'cancelled',
  ]);
  for (let i = 0; i < 100; i += 1) {
    const run = await service.getRun(runId);
    if (run && terminal.has(run.status)) return run.status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} did not reach a terminal status`);
}

describe('ResearchService', () => {
  it('runs a report end-to-end and persists it', async () => {
    const service = makeService(RESEARCH_CAPABILITY_PLAN.map((id) => [id, 'success' as const]));

    const queued = await service.start('NVDA.US');
    expect(queued.status).toBe('queued');
    expect(queued.plannedCapabilities).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);

    const status = await waitForTerminal(service, queued.id);
    expect(status).toBe('completed');

    const run = await service.getRun(queued.id);
    expect(run?.reportId).toBeDefined();
    expect(run?.completedCapabilities).toHaveLength(RESEARCH_CAPABILITY_PLAN.length);

    const reports = await service.listReports('NVDA.US');
    expect(reports).toHaveLength(1);
    expect(reports[0].symbol).toBe('NVDA.US');
  });

  it('rejects a second start for the same symbol while a run is active', async () => {
    const service = makeService([['company.profile', 'slow']]);
    const run = await service.start('NVDA.US');

    try {
      await service.start('NVDA.US');
      throw new Error('expected RESEARCH_RUN_ACTIVE');
    } catch (error) {
      expect((error as { code: string }).code).toBe('RESEARCH_RUN_ACTIVE');
    }

    // The 'slow' capability never resolves on its own — cancel it so the run
    // settles before the tmp dir is removed.
    await service.cancel(run.id);
    expect(await waitForTerminal(service, run.id)).toBe('cancelled');
  });

  it('cancels an in-flight run', async () => {
    const service = makeService([['company.profile', 'slow']]);
    const run = await service.start('NVDA.US');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.cancel(run.id);

    const status = await waitForTerminal(service, run.id);
    expect(status).toBe('cancelled');
  });

  it('lists runs newest-first', async () => {
    const service = makeService([['company.profile', 'success']]);
    const first = await service.start('NVDA.US');
    await waitForTerminal(service, first.id);
    const second = await service.start('AAPL.US');
    await waitForTerminal(service, second.id);

    const runs = await service.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0].id).toBe(second.id);
  });
});

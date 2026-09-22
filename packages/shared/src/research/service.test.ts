import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ResearchReport, ResearchRunStatus, StrategyId } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { RESEARCH_STRATEGIES } from '../strategies/presets.ts';
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

function makeService(
  capabilities: Array<[string, Parameters<typeof fakeCap>[1]?]>,
  repository = new ResearchReportRepository(new JsonFileStore(dir))
) {
  const registry = createCapabilityRegistry(
    capabilities.map(([id, mode]) => fakeCap(id, mode ?? 'success'))
  );
  return new ResearchService({
    registry,
    synthesizer: new LocalResearchSynthesizer(),
    repository,
    now: () => 1_700_000_000_000,
  });
}

/**
 * Poll until the run reaches a terminal status.
 *
 * The budget is wall-clock based, not iteration based: a fixed `100 × 5ms`
 * loop only buys ~500–700ms on a loaded machine, which is shorter than the
 * time the research pipeline itself needs once every poll round-trips through
 * the on-disk run store. On slower machines / saturated CI runners that made
 * otherwise healthy runs look like "did not reach a terminal status" failures.
 */
const TERMINAL_WAIT_MS = 5_000;

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
  const deadline = Date.now() + TERMINAL_WAIT_MS;
  do {
    const run = await service.getRun(runId);
    if (run && terminal.has(run.status)) return run.status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
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

    const report = await service.getReport(run!.reportId!);
    expect(report?.symbol).toBe('NVDA.US');
    const reports = await service.listReports('NVDA.US');
    expect(reports).toHaveLength(1);
    expect(reports[0].symbol).toBe('NVDA.US');
  });

  it('does not expose a terminal status until the report is persisted', async () => {
    const repository = new ResearchReportRepository(new JsonFileStore(dir));
    const persist = repository.saveReport.bind(repository);
    let reportWriteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    let allowReportWrite!: () => void;
    const blocked = new Promise<void>((resolve) => {
      allowReportWrite = resolve;
    });
    repository.saveReport = async (report: ResearchReport) => {
      reportWriteStarted();
      await blocked;
      await persist(report);
    };
    const service = makeService([['company.profile', 'success']], repository);

    const queued = await service.start('NVDA.US');
    await started;

    expect((await service.getRun(queued.id))?.status).toBe('synthesizing');

    allowReportWrite();
    expect(await waitForTerminal(service, queued.id)).toBe('partial');
    const terminal = await service.getRun(queued.id);
    expect(terminal?.reportId).toBeDefined();
    expect(await service.getReport(terminal!.reportId!)).toBeDefined();
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

  it('plans from the strategy and persists strategyId onto the report', async () => {
    const strategy = RESEARCH_STRATEGIES.value;
    const service = makeService(
      strategy.capabilityIds.map((id) => [id, 'success' as const])
    );

    const queued = await service.start('NVDA.US', 'value');
    expect(queued.plannedCapabilities).toEqual([...strategy.capabilityIds]);

    expect(await waitForTerminal(service, queued.id)).toBe('completed');

    const run = await service.getRun(queued.id);
    const report = await service.getReport(run!.reportId!);
    expect(report?.strategyId).toBe('value');
    const reports = await service.listReports('NVDA.US');
    expect(reports).toHaveLength(1);
    expect(reports[0].strategyId).toBe('value');
  });

  it('keeps polling past the old fixed 500ms budget when the pipeline is slow', async () => {
    const service = makeService(RESEARCH_CAPABILITY_PLAN.map((id) => [id, 'success' as const]));
    const realGetRun = service.getRun.bind(service);
    const startedAt = Date.now();
    // Emulate a pipeline that only settles after 800ms of wall-clock — longer
    // than the previous fixed `100 × 5ms` poll budget could ever cover. The
    // run itself is healthy, so waiting must still resolve to `completed`.
    service.getRun = async (runId: string) => {
      const run = await realGetRun(runId);
      if (run && Date.now() - startedAt < 800) {
        return { ...run, status: 'running' as ResearchRunStatus };
      }
      return run;
    };

    const queued = await service.start('NVDA.US');
    expect(await waitForTerminal(service, queued.id)).toBe('completed');
  });

  it('rejects an unknown strategy id', async () => {
    const service = makeService([['company.profile', 'success']]);
    try {
      await service.start('NVDA.US', 'momentum' as StrategyId);
      throw new Error('expected RESEARCH_STRATEGY_INVALID');
    } catch (error) {
      expect((error as { code: string }).code).toBe('RESEARCH_STRATEGY_INVALID');
    }
  });
});

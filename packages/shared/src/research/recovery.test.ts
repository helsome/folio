import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ResearchSynthesizer } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchService, type ResearchServiceOptions } from './service.ts';
import { ResearchReportRepository } from './repository.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { fakeCap } from './test-helpers.ts';
import type { ResearchRunResult } from './runner.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'folio-recovery-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const local = new LocalResearchSynthesizer();
const unavailable: ResearchSynthesizer = { async synthesize() { throw new Error('provider disconnected'); } };
const repository = () => new ResearchReportRepository(new JsonFileStore(dir));
function service(overrides: Partial<ResearchServiceOptions> = {}) {
  return new ResearchService({
    registry: createCapabilityRegistry([fakeCap('company.profile'), fakeCap('research.news')]),
    synthesizer: local, repository: repository(), ...overrides,
  });
}
async function settled(svc: ResearchService, id: string) {
  for (let i = 0; i < 400; i++) {
    const run = await svc.getRun(id);
    if (run && ['interrupted', 'completed', 'partial', 'failed', 'cancelled'].includes(run.status)) return run;
    await Bun.sleep(5);
  }
  throw new Error('Run did not settle');
}
async function interrupted() {
  const svc = service({ synthesizer: unavailable });
  const run = await svc.start('NVDA.US');
  expect((await settled(svc, run.id)).status).toBe('interrupted');
  return run;
}

describe('durable research recovery', () => {
  it('exports the committed terminal result without letting telemetry failure interrupt it', async () => {
    const repo = repository();
    let observed: ResearchRunResult | undefined;
    let persistedStatus: string | undefined;
    let readableReportId: string | undefined;
    let finishHook!: () => void;
    const hookFinished = new Promise<void>((resolve) => { finishHook = resolve; });
    const svc = service({ repository: repo, onRunComplete: async (result) => {
      observed = result;
      try {
        persistedStatus = (await repo.getCheckpoint(result.summary.id))?.summary.status;
        readableReportId = (await repo.getReport(result.summary.reportId!))?.id;
      } finally { finishHook(); }
      throw new Error('telemetry offline');
    } });
    const run = await svc.start('NVDA.US');
    await hookFinished;
    expect(observed?.summary.status).toBe('partial');
    expect(persistedStatus).toBe('partial');
    expect(readableReportId).toBe(observed?.report?.id);
    expect(readableReportId).toBe('report-' + run.id);
    expect((await settled(svc, run.id)).status).toBe('partial');
    expect((await repo.getCheckpoint(run.id))?.summary.error).toBeUndefined();
  });

  it('resumes the same run without refetching evidence, including duplicate resume requests', async () => {
    const old = await interrupted();
    const before = (await repository().getCheckpoint(old.id))!;
    let calls = 0;
    const registry = createCapabilityRegistry(before.plan.filter((p) => p.available).map((p) => ({
      ...fakeCap(p.capabilityId),
      async execute() { throw new Error('completed evidence must not be fetched again'); },
    })));
    const svc = service({ registry, synthesizer: { async synthesize(input) { calls++; return local.synthesize(input); } } });
    expect((await svc.getRun(old.id))?.status).toBe('interrupted');
    const results = await Promise.all([svc.resume(old.id), svc.resume(old.id), svc.resume(old.id)]);
    expect(results.every((r) => r.id === old.id)).toBe(true);
    expect((await settled(svc, old.id)).status).toBe('partial');
    const after = (await repository().getCheckpoint(old.id))!;
    expect(after.outcomes).toEqual(before.outcomes);
    expect(after.retry.attempts).toEqual(before.retry.attempts);
    expect(after.retry.synthesisAttempts).toBe(2);
    expect(after.budget.usage.toolCalls).toBe(before.budget.usage.toolCalls);
    expect(after.summary.recoveryCount).toBe(1);
    expect(after.events.filter((e) => e.type === 'recovery')).toHaveLength(1);
    expect(after.events.every((e) => e.runId === old.id && e.parentRunId === old.id)).toBe(true);
    expect(calls).toBe(1);
    const report = (await svc.listReports('NVDA.US'))[0];
    expect(new Set(report.sections.map((s) => s.key)).size).toBe(report.sections.length);
    expect(new Set(report.capabilityRuns.map((r) => r.capabilityId)).size).toBe(report.capabilityRuns.length);
    const evidence = report.sections.flatMap((s) => s.evidence);
    expect(new Set(evidence.map((e) => e.runId + ':' + e.capabilityId)).size).toBe(evidence.length);
    await svc.resume(old.id);
    expect(calls).toBe(1);
    expect(await svc.listReports('NVDA.US')).toHaveLength(1);
  });

  it('commits the report before the terminal status and replays publication idempotently', async () => {
    const svc = service({ onReport() { throw new Error('crash after report write'); } });
    const run = await svc.start('NVDA.US');
    expect((await settled(svc, run.id)).status).toBe('interrupted');
    const cp = (await repository().getCheckpoint(run.id))!;
    expect(cp.phase).toBe('publishing');
    expect(cp.report).toBeDefined();
    const resumed = service({ synthesizer: unavailable });
    await resumed.resume(run.id);
    expect((await settled(resumed, run.id)).status).toBe('partial');
    expect(await resumed.getReport('report-' + run.id)).toEqual(cp.report);
    expect(await resumed.listReports('NVDA.US')).toHaveLength(1);
    expect((await repository().getCheckpoint(run.id))?.retry).toEqual(cp.retry);
  });

  it('discovers orphan checkpoints even if runs.json is missing or corrupt', async () => {
    const run = await interrupted();
    await writeFile(join(dir, 'research/runs.json'), 'broken');
    const restarted = service();
    expect((await restarted.listRuns()).find((r) => r.id === run.id)?.status).toBe('interrupted');
    await restarted.resume(run.id);
    expect((await settled(restarted, run.id)).status).toBe('partial');
  });

  it('repairs missing report and index projections from a completed checkpoint', async () => {
    const svc = service();
    const run = await svc.start('NVDA.US');
    const done = await settled(svc, run.id);
    const original = await svc.getReport(done.reportId!);
    await rm(join(dir, 'research/reports', done.reportId! + '.json'));
    await rm(join(dir, 'research/index.json'));
    const restarted = service({ synthesizer: unavailable });
    expect(await restarted.getReport(done.reportId!)).toEqual(original);
    expect(await restarted.listReports('NVDA.US')).toHaveLength(1);
    expect((await restarted.getRun(run.id))?.status).toBe('partial');
  });

  it('shows a disk failure without leaving an inactive worker in fetching state', async () => {
    class FailingRepository extends ResearchReportRepository {
      checkpointWrites = 0;
      override async saveCheckpoint(cp: Parameters<ResearchReportRepository['saveCheckpoint']>[0]) {
        if (++this.checkpointWrites > 1) throw new Error('disk full');
        return super.saveCheckpoint(cp);
      }
    }
    const svc = service({ repository: new FailingRepository(new JsonFileStore(dir)) });
    const run = await svc.start('NVDA.US');
    const failed = await settled(svc, run.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('disk full');
    expect((await repository().getCheckpoint(run.id))?.summary.status).toBe('queued');
    const restarted = service();
    expect((await restarted.getRun(run.id))?.status).toBe('interrupted');
    await restarted.resume(run.id);
    expect((await settled(restarted, run.id)).status).toBe('partial');
  });

  for (const failure of ['truncated', 'checksum', 'version', 'duplicate evidence']) {
    it('fails safely and preserves a ' + failure + ' checkpoint', async () => {
      const run = await interrupted();
      const file = join(dir, 'research/checkpoints', run.id + '.json');
      const envelope = JSON.parse(await readFile(file, 'utf8'));
      if (failure === 'version' || failure === 'duplicate evidence') {
        const payload = JSON.parse(envelope.payload);
        if (failure === 'version') payload.version = 99;
        else payload.outcomes.push(payload.outcomes[0]);
        envelope.payload = JSON.stringify(payload);
        envelope.checksum = createHash('sha256').update(envelope.payload).digest('hex');
      }
      if (failure === 'checksum') envelope.checksum = 'wrong';
      const bad = failure === 'truncated' ? '{' : JSON.stringify(envelope);
      await writeFile(file, bad);
      const restarted = service();
      const summary = await restarted.getRun(run.id);
      expect(summary?.status).toBe('failed');
      expect(summary?.recoverable).toBe(false);
      expect(summary?.error).toBeTruthy();
      expect(await readFile(file, 'utf8')).toBe(bad);
      expect(await restarted.listReports()).toHaveLength(0);
      await restarted.discard(run.id);
      expect((await service().getRun(run.id))?.status).toBe('cancelled');
      expect(await readFile(file, 'utf8')).toBe(bad);
    });
  }

  it('reconciles legacy running summaries without pretending they can resume', async () => {
    await repository().saveRunSummary({
      id: 'legacy', symbol: 'NVDA.US', status: 'fetching', startedAt: 1,
      plannedCapabilities: [], completedCapabilities: [], failedCapabilities: [],
    });
    const svc = service();
    expect((await svc.getRun('legacy'))?.status).toBe('interrupted');
    expect((await svc.getRun('legacy'))?.recoverable).toBe(false);
    expect(svc.resume('legacy')).rejects.toThrow('no checkpoint');
    await svc.discard('legacy');
  });

  it('rejects changed model/config identity and restarts under a new run id', async () => {
    const run = await interrupted();
    const svc = service({ getIdentity: async () => ({ provider: 'other', model: 'other', config: 'new' }) });
    expect(svc.resume(run.id)).rejects.toThrow('changed');
    const fresh = await svc.restart(run.id);
    expect(fresh.id).not.toBe(run.id);
    expect((await svc.getRun(run.id))?.status).toBe('cancelled');
    await settled(svc, fresh.id);
    expect((await repository().getCheckpoint(fresh.id))?.summary.recoveryCount).toBe(0);
  });

  it('persists cancelled runs and never resumes their remaining steps', async () => {
    const svc = service({ registry: createCapabilityRegistry([fakeCap('company.profile', 'slow')]) });
    const run = await svc.start('NVDA.US');
    await svc.cancel(run.id);
    const restarted = service();
    expect((await restarted.getRun(run.id))?.status).toBe('cancelled');
    expect((await restarted.resume(run.id)).status).toBe('cancelled');
    expect(await restarted.listReports()).toHaveLength(0);
  });

  it('preserves spent budget across recovery instead of resetting it', async () => {
    const svc = service({ synthesizer: unavailable, budgets: { defaults: { modelCalls: 1 } } });
    const run = await svc.start('NVDA.US');
    await settled(svc, run.id);
    const restarted = service();
    await restarted.resume(run.id);
    const failed = await settled(restarted, run.id);
    expect(failed.error).toContain('budget exhausted');
    expect((await repository().getCheckpoint(run.id))?.budget.usage.modelCalls).toBe(1);
    expect(await restarted.listReports()).toHaveLength(0);
  });

  it('refuses side-effecting capabilities before dispatch', async () => {
    let called = false;
    const svc = service({ registry: createCapabilityRegistry([{
      ...fakeCap('company.profile'), riskLevel: 'write',
      async execute() { called = true; throw new Error('must not run'); },
    }]) });
    const run = await svc.start('NVDA.US');
    expect((await settled(svc, run.id)).error).toContain('read-only');
    expect(called).toBe(false);
  });
});

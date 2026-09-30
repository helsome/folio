import { getEventListeners } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ResearchSynthesis, ResearchSynthesisInput } from '@finagent/core';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchReportRepository } from './repository.ts';
import { ResearchRunner } from './runner.ts';
import { ResearchService } from './service.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { fakeCap } from './test-helpers.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'folio-synthesis-cancel-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const local = new LocalResearchSynthesizer();
const registry = () => createCapabilityRegistry([fakeCap('company.profile')]);

async function finished(service: ResearchService, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = await service.getRun(id);
    if (run && ['completed', 'partial', 'failed', 'interrupted'].includes(run.status)) return run;
    await Bun.sleep(5);
  }
  throw new Error('Replacement research did not finish');
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Cancellation is still waiting for synthesis')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('research synthesis cancellation', () => {
  for (const lateOutcome of ['resolve', 'reject'] as const) {
    it(`settles cancel and releases the symbol before a late synthesis ${lateOutcome}`, async () => {
      const entered = Promise.withResolvers<ResearchSynthesisInput>();
      const blocked = Promise.withResolvers<ResearchSynthesis>();
      const published: string[] = [];
      let calls = 0;
      const repository = new ResearchReportRepository(new JsonFileStore(dir));
      const service = new ResearchService({
        registry: registry(), repository,
        synthesizer: {
          synthesize(input) {
            if (++calls === 1) { entered.resolve(input); return blocked.promise; }
            return local.synthesize(input);
          },
        },
        onReport: (report) => { published.push(report.id); },
      });
      const first = await service.start('NVDA.US');
      const input = await entered.promise;
      const cancellation = service.cancel(first.id);
      try {
        await bounded(cancellation);
        const cancelled = (await repository.listRunSummaries()).find((run) => run.id === first.id);
        expect(cancelled).toMatchObject({ status: 'cancelled', cancelled: true, recoverable: false });
        expect(cancelled?.completedCapabilities).toContain('company.profile');
        expect(cancelled?.failedCapabilities).not.toContain('company.profile');
        expect(await repository.listBySymbol('NVDA.US')).toHaveLength(0);

        // Exercise the real service reservation, not just the displayed status.
        const replacement = await service.start('NVDA.US');
        expect((await bounded(finished(service, replacement.id))).status).toBe('partial');
        expect(await repository.getReport(`report-${replacement.id}`)).toBeDefined();
        // The retired synthesis must not append to the durable checkpoint.
        await input.recovery?.onAgentRun('late-agent-run', 'late-session');
        expect((await repository.getCheckpoint(first.id))?.events.some(
          (event) => event.agentRunId === 'late-agent-run'
        )).toBe(false);
      } finally {
        if (lateOutcome === 'resolve') blocked.resolve(await local.synthesize(input));
        else blocked.reject(new Error('late provider failure'));
        await cancellation;
      }
      await Bun.sleep(10);
      expect((await service.getRun(first.id))?.status).toBe('cancelled');
      expect(await repository.getReport(`report-${first.id}`)).toBeUndefined();
      expect(published).not.toContain(`report-${first.id}`);
    });
  }

  it('settles service cancellation while a real child synthesizer is still waiting', async () => {
    // Controlled subprocess boundary; no provider credential or real model is used.
    const worker = spawn(process.execPath, ['-e',
      'process.stdout.write("ready\\n"); process.stdin.resume();'
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const exited = Promise.withResolvers<void>();
    worker.once('exit', () => exited.resolve());
    const entered = Promise.withResolvers<void>();
    const synthesisEntered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<ResearchSynthesis>();
    const onError = (error: Error) => { entered.reject(error); response.reject(error); };
    worker.once('error', onError);
    worker.stdout.once('data', () => entered.resolve());
    const repository = new ResearchReportRepository(new JsonFileStore(dir));
    const service = new ResearchService({
      registry: registry(), repository,
      synthesizer: {
        async synthesize() {
          await entered.promise;
          synthesisEntered.resolve();
          return response.promise;
        },
      },
    });
    let cancellation: Promise<void> | undefined;
    try {
      const run = await service.start('NVDA.US');
      await synthesisEntered.promise;
      cancellation = service.cancel(run.id);
      await bounded(cancellation);
      expect(worker.exitCode).toBeNull();
      expect((await service.getRun(run.id))?.status).toBe('cancelled');
      expect(await repository.listBySymbol('NVDA.US')).toHaveLength(0);
      const replacement = await service.start('NVDA.US');
      await service.cancel(replacement.id);
    } finally {
      // Release the external resource explicitly; orchestration cannot force an
      // arbitrary synthesizer to stop its underlying process or network request.
      response.reject(new Error('controlled child stopped'));
      worker.kill();
      await exited.promise;
      await cancellation;
    }
  });

  it('does not invoke synthesis if cancellation arrives at the synthesizing transition', async () => {
    const controller = new AbortController();
    let calls = 0;
    const runner = new ResearchRunner({
      registry: registry(),
      synthesizer: { synthesize(input) { calls++; return local.synthesize(input); } },
    });
    const result = await runner.run({
      runId: 'before-model', symbol: 'NVDA.US', signal: controller.signal,
      onStatus(summary) { if (summary.status === 'synthesizing') controller.abort(); },
    });
    expect(result.summary.status).toBe('cancelled');
    expect(result.report).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('cancels a blocked pre-synthesis identity check without launching the model later', async () => {
    const entered = Promise.withResolvers<void>();
    const blocked = Promise.withResolvers<void>();
    let calls = 0;
    const runner = new ResearchRunner({
      registry: registry(),
      synthesizer: { synthesize(input) { calls++; return local.synthesize(input); } },
    });
    const controller = new AbortController();
    const running = runner.run({
      runId: 'preflight', symbol: 'NVDA.US', signal: controller.signal,
      beforeSynthesis() { entered.resolve(); return blocked.promise; },
    });
    await entered.promise;
    controller.abort();
    try {
      const result = await bounded(running);
      expect(result.summary.status).toBe('cancelled');
      expect(result.report).toBeUndefined();
    } finally {
      blocked.resolve();
      await running;
    }
    expect(calls).toBe(0);
  });

  for (const outcome of ['success', 'failure', 'cancel'] as const) {
    it(`removes its abort listeners after synthesis ${outcome}`, async () => {
      const controller = new AbortController();
      const baseline = getEventListeners(controller.signal, 'abort').length;
      const runner = new ResearchRunner({
        registry: registry(),
        synthesizer: {
          synthesize(input) {
            if (outcome === 'failure') return Promise.reject(new Error('model failed'));
            if (outcome === 'cancel') {
              controller.abort();
              return new Promise<ResearchSynthesis>(() => {});
            }
            return local.synthesize(input);
          },
        },
      });
      const result = await bounded(runner.run({
        runId: outcome, symbol: 'NVDA.US', signal: controller.signal,
      }));
      expect(result.summary.status).toBe(outcome === 'success' ? 'partial' : outcome === 'failure' ? 'failed' : 'cancelled');
      expect(getEventListeners(controller.signal, 'abort').length).toBe(baseline);
    });
  }
});

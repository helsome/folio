import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { describe, expect, it } from 'bun:test';
import type { EvaluationRun } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { DEFAULT_EVALUATION_SETTINGS } from './settings.ts';
import { EvaluationStore, type HumanFeedback, type TraceLinkRecord } from './store.ts';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}

/** Pause an already-cloned snapshot; other I/O completes without timer races. */
class SnapshotStore extends JsonFileStore {
  private gate?: { captured: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> };
  failNextWrite?: Error;

  constructor(root: string, private readonly files: Map<string, unknown>) {
    super(root);
  }

  private key(file: string): string {
    const path = resolve(this.resolve(file));
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }

  pauseNextRead() {
    const captured = deferred();
    const resume = deferred();
    this.gate = { captured, resume };
    return { captured: captured.promise, release: resume.release };
  }

  override async read<T>(file: string, fallback: T): Promise<T> {
    const key = this.key(file);
    const snapshot = structuredClone(this.files.has(key) ? this.files.get(key) : fallback) as T;
    const gate = this.gate;
    if (gate) {
      this.gate = undefined;
      gate.captured.release();
      await gate.resume.promise;
    }
    return snapshot;
  }

  override async write(file: string, data: unknown): Promise<void> {
    if (this.failNextWrite) {
      const failure = this.failNextWrite;
      this.failNextWrite = undefined;
      throw failure;
    }
    this.files.set(this.key(file), structuredClone(data));
  }
}

function harness(uppercaseAlias = false) {
  const root = join(process.cwd(), 'evaluation-concurrency-fixtures', randomUUID());
  const files = new Map<string, unknown>();
  const firstDisk = new SnapshotStore(root, files);
  const alias = uppercaseAlias ? root.toUpperCase() : relative(process.cwd(), root);
  const secondDisk = new SnapshotStore(alias, files);
  return { firstDisk, first: new EvaluationStore(firstDisk), second: new EvaluationStore(secondDisk) };
}

function feedback(id: string): HumanFeedback {
  return { id, caseId: 'case-1', verdict: 'good', createdAt: 1_000 };
}

function trace(runId: string): TraceLinkRecord {
  return { runId, traceRef: { backend: 'local', runId }, recordedAt: 1_000 };
}

function run(id: string): EvaluationRun {
  return {
    id, experimentId: '__observability__', caseId: '', datasetId: '',
    status: 'completed', startedAt: 1_000, completedAt: 1_500,
    toolCalls: [], failureModes: [],
  };
}

describe('EvaluationStore concurrent writes', () => {
  it('keeps both feedback records when writes overlap on one instance', async () => {
    const { firstDisk, first, second } = harness();
    const gate = firstDisk.pauseNextRead();
    const initial = first.addFeedback(feedback('first'));
    await gate.captured;
    const next = first.addFeedback(feedback('second'));
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    await Promise.all([initial, next]);
    expect((await second.listFeedback()).map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  for (const uppercaseAlias of [false, true]) {
    it.skipIf(uppercaseAlias && process.platform !== 'win32')(
      `keeps feedback, settings and trace links across ${uppercaseAlias ? 'Windows case aliases' : 'absolute and relative roots'}`,
      async () => {
        const { firstDisk, first, second } = harness(uppercaseAlias);
        const gate = firstDisk.pauseNextRead();
        const initial = first.addFeedback(feedback('first'));
        await gate.captured;
        const savedSettings = second.saveSettings({ ...DEFAULT_EVALUATION_SETTINGS, langsmithProject: 'new-project' });
        const savedTrace = second.recordTraceLink(trace('run-1'));
        try {
          await checkpoint();
        } finally {
          gate.release();
        }
        await Promise.all([initial, savedSettings, savedTrace]);
        expect(await second.listFeedback()).toEqual([feedback('first')]);
        expect((await second.getSettings()).langsmithProject).toBe('new-project');
        expect(await second.lookupTraceLink('run-1')).toEqual(trace('run-1'));
      }
    );
  }

  it('propagates a failed write and allows queued and later writes to finish', async () => {
    const { firstDisk, first, second } = harness();
    const failure = new Error('simulated write failure');
    firstDisk.failNextWrite = failure;
    const gate = firstDisk.pauseNextRead();
    const initial = first.addFeedback(feedback('failed'));
    await gate.captured;
    const next = second.addFeedback(feedback('next'));
    const settled = Promise.allSettled([initial, next]);
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    expect(await settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: undefined },
    ]);
    await first.addFeedback(feedback('later'));
    expect((await second.listFeedback()).map((entry) => entry.id)).toEqual(['next', 'later']);
  });

  it('reloads every run, trace and feedback after concurrent real JSON writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folio-evaluation-concurrency-'));
    try {
      const first = new EvaluationStore(new JsonFileStore(root));
      const second = new EvaluationStore(new JsonFileStore(root));
      const ids = Array.from({ length: 12 }, (_, index) => `run-${index}`);
      await Promise.all(ids.flatMap((id) => [
        first.addRun(run(id)), second.recordTraceLink(trace(id)), first.addFeedback(feedback(id)),
      ]));

      const reloaded = new EvaluationStore(new JsonFileStore(root));
      expect((await reloaded.listRuns()).map((entry) => entry.id).sort()).toEqual([...ids].sort());
      expect((await reloaded.listFeedback()).map((entry) => entry.id).sort()).toEqual([...ids].sort());
      for (const id of ids) expect(await reloaded.lookupTraceLink(id)).toEqual(trace(id));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

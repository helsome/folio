import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { describe, expect, it } from 'bun:test';
import type { InvestmentThesis, ThesisImpact } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ThesisImpactRepository, ThesisRepository } from './repository.ts';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}

/**
 * Capture a complete read snapshot before pausing it. All other operations
 * use resolved promises, so one event-loop checkpoint drains every ready
 * mutation without a timer or filesystem timing assumption.
 */
class SnapshotStore extends JsonFileStore {
  private gate?: { file: string; captured: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> };
  failNextWrite?: { file: string; error: Error };

  constructor(root: string, private readonly files: Map<string, unknown>) {
    super(root);
  }

  private key(file: string): string {
    const path = resolve(this.resolve(file));
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }

  pauseNextRead(file: string) {
    const captured = deferred();
    const resume = deferred();
    this.gate = { file, captured, resume };
    return { captured: captured.promise, release: resume.release };
  }

  override async read<T>(file: string, fallback: T): Promise<T> {
    const key = this.key(file);
    // The cast matches JsonFileStore's JSON.parse boundary; snapshots are
    // cloned so another writer cannot mutate a reader's already-read value.
    const snapshot = structuredClone(this.files.has(key) ? this.files.get(key) : fallback) as T;
    const gate = this.gate;
    if (gate?.file === file) {
      this.gate = undefined;
      gate.captured.release();
      await gate.resume.promise;
    }
    return snapshot;
  }

  override async write(file: string, data: unknown): Promise<void> {
    if (this.failNextWrite?.file === file) {
      const { error } = this.failNextWrite;
      this.failNextWrite = undefined;
      throw error;
    }
    this.files.set(this.key(file), structuredClone(data));
  }

  override async remove(file: string): Promise<void> {
    this.files.delete(this.key(file));
  }
}

function withStore<T extends object>(repository: T, store: JsonFileStore): T {
  // Keep the production constructor/API unchanged while controlling its I/O.
  Object.defineProperty(repository, 'store', { value: store });
  return repository;
}

function harness(uppercaseAlias = false) {
  const root = join(process.cwd(), 'thesis-concurrency-fixtures', randomUUID());
  const files = new Map<string, unknown>();
  const firstStore = new SnapshotStore(root, files);
  const alias = uppercaseAlias ? root.toUpperCase() : relative(process.cwd(), root);
  const secondStore = new SnapshotStore(alias, files);
  return {
    firstStore,
    secondStore,
    first: withStore(new ThesisRepository({ storageDir: root }), firstStore),
    second: withStore(new ThesisRepository({ storageDir: alias }), secondStore),
    firstImpacts: withStore(new ThesisImpactRepository({ storageDir: root }), firstStore),
    secondImpacts: withStore(new ThesisImpactRepository({ storageDir: alias }), secondStore),
  };
}

function thesis(id: string, summary = id): InvestmentThesis {
  return {
    id, symbol: 'NVDA.US', stance: 'bullish', summary,
    bullCase: [], bearCase: [], catalysts: [], risks: [], evidenceRefs: [],
    createdAt: 1000, updatedAt: 1000, lastReviewedAt: 1000,
  };
}

function impact(id: string, thesisId = 'thesis-1'): ThesisImpact {
  return {
    id, thesisId, symbol: 'NVDA.US', evaluatedAt: 1000, kind: 'unchanged',
    summary: id, evidence: [], thesis: thesis(thesisId),
  };
}

describe('ThesisRepository concurrent mutations', () => {
  for (const acrossInstances of [false, true]) {
    it(`keeps both saved theses ${acrossInstances ? 'across instances and absolute/relative roots' : 'on one instance'}`, async () => {
      const { firstStore, first, second } = harness();
      const gate = firstStore.pauseNextRead('index.json');
      const initial = first.save(thesis('first'));
      await gate.captured;
      const next = (acrossInstances ? second : first).save(thesis('second'));
      try {
        await checkpoint();
      } finally {
        gate.release();
      }
      await Promise.all([initial, next]);
      expect((await second.list()).map((value) => value.id).sort()).toEqual(['first', 'second']);
      expect((await second.getBySymbol('NVDA.US')).map((value) => value.id).sort()).toEqual(['first', 'second']);
    });
  }

  it('keeps the body and index deleted when delete follows an in-flight save', async () => {
    const { firstStore, first, second } = harness();
    await first.save(thesis('same', 'old'));
    const gate = firstStore.pauseNextRead('index.json');
    const saved = first.save(thesis('same', 'new'));
    await gate.captured;
    const deleted = second.delete('same');
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    await Promise.all([saved, deleted]);
    expect(await second.get('same')).toBeUndefined();
    expect(await firstStore.read('index.json', {})).toEqual({});
    expect(await second.list()).toEqual([]);
  });

  it('keeps the new body indexed when save follows an in-flight delete', async () => {
    const { firstStore, first, second } = harness();
    await first.save(thesis('same', 'old'));
    const gate = firstStore.pauseNextRead('index.json');
    const deleted = first.delete('same');
    await gate.captured;
    const saved = second.save(thesis('same', 'new'));
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    await Promise.all([deleted, saved]);
    expect(await second.get('same')).toMatchObject({ summary: 'new' });
    expect(await second.list()).toEqual([thesis('same', 'new')]);
    expect(await firstStore.read('index.json', {})).toEqual({ same: { symbol: 'NVDA.US', updatedAt: 1000 } });
  });

  it('propagates a failed index write and lets the next queued save complete', async () => {
    const { firstStore, first, second } = harness();
    const failure = new Error('simulated index write failure');
    firstStore.failNextWrite = { file: 'index.json', error: failure };
    const gate = firstStore.pauseNextRead('index.json');
    const initial = first.save(thesis('failed'));
    await gate.captured;
    const next = second.save(thesis('next'));
    const settled = Promise.allSettled([initial, next]);
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    expect(await settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: thesis('next') },
    ]);
    await first.save(thesis('later'));
    expect((await second.list()).map((value) => value.id).sort()).toEqual(['later', 'next']);
  });

  it.skipIf(process.platform !== 'win32')('shares the index lock across differently cased Windows roots', async () => {
    const { firstStore, first, second } = harness(true);
    const gate = firstStore.pauseNextRead('index.json');
    const initial = first.save(thesis('first'));
    await gate.captured;
    const next = second.save(thesis('second'));
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    await Promise.all([initial, next]);
    expect((await second.list()).map((value) => value.id).sort()).toEqual(['first', 'second']);
  });
});

describe('ThesisImpactRepository concurrent mutations', () => {
  it('appends both history entries across repository instances', async () => {
    const { firstStore, firstImpacts, secondImpacts } = harness();
    const gate = firstStore.pauseNextRead('impacts/thesis-1.json');
    const initial = firstImpacts.append(impact('first'));
    await gate.captured;
    const next = secondImpacts.append(impact('second'));
    try {
      await checkpoint();
    } finally {
      gate.release();
    }
    await Promise.all([initial, next]);
    expect((await secondImpacts.list('thesis-1')).map((value) => value.id)).toEqual(['first', 'second']);
  });

  it('does not block a different thesis history behind a paused append', async () => {
    const { firstStore, firstImpacts, secondImpacts } = harness();
    const gate = firstStore.pauseNextRead('impacts/thesis-1.json');
    const initial = firstImpacts.append(impact('first'));
    await gate.captured;
    let completed = false;
    const next = secondImpacts.append(impact('second', 'thesis-2')).then(() => { completed = true; });
    try {
      await checkpoint();
      expect(completed).toBe(true);
    } finally {
      gate.release();
      await Promise.all([initial, next]);
    }
    expect((await secondImpacts.list('thesis-2')).map((value) => value.id)).toEqual(['second']);
  });

  it('propagates a failed append and recovers the shared history queue', async () => {
    const { firstStore, firstImpacts, secondImpacts } = harness();
    const file = 'impacts/thesis-1.json';
    const failure = new Error('simulated history write failure');
    firstStore.failNextWrite = { file, error: failure };
    const gate = firstStore.pauseNextRead(file);
    const initial = firstImpacts.append(impact('failed'));
    await gate.captured;
    const next = secondImpacts.append(impact('next'));
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
    await firstImpacts.append(impact('later'));
    expect((await secondImpacts.list('thesis-1')).map((value) => value.id)).toEqual(['next', 'later']);
  });
});

it('reloads every concurrent thesis and impact from real JSON files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'folio-thesis-concurrent-'));
  try {
    const first = new ThesisRepository({ storageDir: root });
    const second = new ThesisRepository({ storageDir: root });
    const values = Array.from({ length: 20 }, (_, index) => thesis(`thesis-${index}`));
    const saves = await Promise.allSettled(values.map((value, index) => (index % 2 ? first : second).save(value)));
    expect(saves.filter((result) => result.status === 'rejected')).toEqual([]);
    const reloaded = new ThesisRepository({ storageDir: root });
    expect((await reloaded.list()).map((value) => value.id).sort()).toEqual(values.map((value) => value.id).sort());
    expect(await reloaded.getBySymbol('NVDA.US')).toHaveLength(values.length);

    const firstImpacts = new ThesisImpactRepository({ storageDir: root });
    const secondImpacts = new ThesisImpactRepository({ storageDir: root });
    const impacts = Array.from({ length: 20 }, (_, index) => impact(`impact-${index}`));
    const appends = await Promise.allSettled(impacts.map((value, index) => (index % 2 ? firstImpacts : secondImpacts).append(value)));
    expect(appends.filter((result) => result.status === 'rejected')).toEqual([]);
    const history = await new ThesisImpactRepository({ storageDir: root }).list('thesis-1');
    expect(history.map((value) => value.id).sort()).toEqual(impacts.map((value) => value.id).sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

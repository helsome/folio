import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Message, Run, SessionMeta } from '@finagent/core';
import { JsonFileStore } from './json-file-store.ts';
import { MessageRepository } from './message-repository.ts';
import { RunRepository } from './run-repository.ts';
import { SessionRepository } from './session-repository.ts';

let dir = '';
let store: JsonFileStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-store-'));
  store = new JsonFileStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeSession(id: string): SessionMeta {
  return {
    id,
    title: `Session ${id}`,
    status: 'idle',
    createdAt: 1000,
    updatedAt: 1000,
    messageCount: 0,
    runtimeSessionPath: `/tmp/pi/${id}.jsonl`,
  };
}

function makeMessage(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: 1000 };
}

describe('JsonFileStore', () => {
  it('writes and reads back JSON', async () => {
    await store.write('a.json', { hello: 'world' });
    expect(await store.read('a.json', {})).toEqual({ hello: 'world' });
  });

  it('returns the fallback for missing files', async () => {
    expect(await store.read('missing.json', [1])).toEqual([1]);
  });

  it('never leaves a partial file behind after writes', async () => {
    await store.write('a.json', { ok: true });
    const files = await readdir(dir);
    expect(files.filter((file) => !file.endsWith('.tmp'))).toEqual(['a.json']);
  });
});

describe('SessionRepository', () => {
  it('persists sessions across store instances (reload)', async () => {
    const first = new SessionRepository(store);
    await first.upsert(makeSession('s1'));

    // New store instance on the same directory simulates an app restart.
    const second = new SessionRepository(new JsonFileStore(dir));
    const sessions = await second.list();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 's1', title: 'Session s1' });
  });

  it('updates existing sessions in place', async () => {
    const repo = new SessionRepository(store);
    await repo.upsert(makeSession('s1'));

    await repo.upsert({ ...makeSession('s1'), title: 'Renamed', messageCount: 3 });
    const sessions = await repo.list();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ title: 'Renamed', messageCount: 3 });
  });

  it('removes sessions and their message/run files', async () => {
    const repo = new SessionRepository(store);
    await repo.upsert(makeSession('s1'));
    await store.write('sessions/s1/messages.json', { messages: [] });

    await repo.remove('s1');

    expect(await repo.list()).toEqual([]);
    expect(await store.read('sessions/s1/messages.json', null)).toBeNull();
  });
});

describe('MessageRepository', () => {
  it('appends messages in order and persists them', async () => {
    const repo = new MessageRepository(store);
    await repo.append('s1', makeMessage('m1', 'first'));
    await repo.append('s1', makeMessage('m2', 'second'));

    const reloaded = new MessageRepository(new JsonFileStore(dir));
    const messages = await reloaded.list('s1');

    expect(messages.map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('keeps sessions isolated', async () => {
    const repo = new MessageRepository(store);
    await repo.append('s1', makeMessage('m1', 'for s1'));
    await repo.append('s2', makeMessage('m2', 'for s2'));

    expect((await repo.list('s1')).map((message) => message.id)).toEqual(['m1']);
    expect((await repo.list('s2')).map((message) => message.id)).toEqual(['m2']);
  });
});

describe('RunRepository', () => {
  it('creates, updates, and reloads runs', async () => {
    const repo = new RunRepository(store);
    const run: Run = {
      id: 'r1',
      sessionId: 's1',
      status: 'running',
      input: 'analyze portfolio',
      startedAt: 1000,
    };
    await repo.create(run);

    const completed: Run = { ...run, status: 'completed', completedAt: 2000, answer: 'done' };
    await repo.update(completed);

    const reloaded = new RunRepository(new JsonFileStore(dir));
    const runs = await reloaded.list('s1');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', answer: 'done', completedAt: 2000 });
  });

  it('lists runs newest first', async () => {
    const repo = new RunRepository(store);
    await repo.create({ id: 'r1', sessionId: 's1', status: 'completed', input: 'a', startedAt: 1000 });
    await repo.create({ id: 'r2', sessionId: 's1', status: 'completed', input: 'b', startedAt: 2000 });

    const runs = await repo.list('s1');
    expect(runs.map((run) => run.id)).toEqual(['r2', 'r1']);
  });
});

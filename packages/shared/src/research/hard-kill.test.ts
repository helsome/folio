import { expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ResearchReportRepository } from './repository.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';

it('hard-kills an executing service process and completes the same run in a fresh process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folio-hard-kill-'));
  let child: ChildProcess | undefined;
  let spawnError: Error | undefined;
  const worker = fileURLToPath(new URL('./fixtures/crash-worker.ts', import.meta.url));
  const launch = (...args: string[]) => {
    const proc = spawn(process.execPath, [worker, dir, ...args], { stdio: 'ignore', windowsHide: true });
    proc.on('error', (error) => { spawnError = error; });
    return proc;
  };
  async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 500; i++) {
      if (spawnError) throw spawnError;
      if (child?.exitCode != null && child.exitCode !== 0) throw new Error('Crash worker failed: ' + child.exitCode);
      const result = await read().catch(() => undefined);
      if (result) return result;
      await Bun.sleep(10);
    }
    throw new Error('Worker did not reach checkpoint');
  }
  try {
    child = launch('start');
    const started = await waitFor(async () => JSON.parse(await readFile(join(dir, 'started.json'), 'utf8')));
    const repository = new ResearchReportRepository(new JsonFileStore(dir));
    const before = await waitFor(async () => {
      const cp = await repository.getCheckpoint(started.id);
      return cp?.outcomes.some((o) => o.record.capabilityId === 'company.profile') &&
        cp.inFlight.includes('research.news') ? cp : undefined;
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    child = launch('resume', started.id);
    const completed = once(child, 'exit');
    await waitFor(async () => JSON.parse(await readFile(join(dir, 'finished.json'), 'utf8')));
    expect((await completed)[0]).toBe(0);
    const reconciled = JSON.parse(await readFile(join(dir, 'reconciled.json'), 'utf8'));
    expect(reconciled.status).toBe('interrupted');
    const after = (await repository.getCheckpoint(started.id))!;
    expect(after.summary.id).toBe(before.summary.id);
    expect(after.summary.status).toBe('partial');
    expect(after.outcomes.find((o) => o.record.capabilityId === 'company.profile')).toEqual(before.outcomes[0]);
    expect(after.retry.attempts['company.profile']).toBe(1);
    expect(after.retry.attempts['research.news']).toBe(2);
    expect(after.summary.recoveryCount).toBe(1);
    expect(await repository.listBySymbol('NVDA.US')).toHaveLength(1);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGKILL');
      await stopped;
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);

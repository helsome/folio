import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BackgroundJob } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { BackgroundJobRepository, BackgroundJobScheduler } from './job-engine.ts';

const now = 1_800_000_000_000;
function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return { id: 'filings-aapl', type: 'filing-check', enabled: true, schedule: { intervalMs: 60_000 }, input: { symbol: 'AAPL.US' }, createdAt: now - 60_000, nextRunAt: now - 1_000, status: 'scheduled', retryPolicy: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 2 }, missedRunPolicy: 'catch-up', notificationPolicy: { onSuccess: true, onFailure: true, sensitivePreview: false }, ...overrides };
}
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'folio-jobs-')); return { dir, repo: new BackgroundJobRepository(new JsonFileStore(dir)) }; }

describe('persistent background jobs', () => {
  it('restores schedules and last-run state after restart', async () => {
    const { dir, repo } = await setup();
    await repo.saveJob(job());
    const scheduler = new BackgroundJobScheduler(repo, { run: async () => ({ productionRunId: 'research-1' }) }, { now: () => now });
    await scheduler.tick();
    const restarted = new BackgroundJobRepository(new JsonFileStore(dir));
    expect((await restarted.listJobs())[0]).toMatchObject({ status: 'succeeded', lastRunId: expect.any(String) });
    expect((await restarted.listRuns())[0]).toMatchObject({ status: 'succeeded', productionRunId: 'research-1' });
    expect((await restarted.listNotifications())[0]?.deepLink).toBe('/runs/research-1');
  });

  it('prevents duplicate concurrent claims', async () => {
    const { repo } = await setup();
    await repo.saveJob(job());
    const claims = await Promise.all([repo.claimDue('filings-aapl', now), repo.claimDue('filings-aapl', now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('keeps a running claim leased beyond the research deadline', async () => {
    const { repo } = await setup();
    await repo.saveJob(job());
    expect(await repo.claimDue('filings-aapl', now)).toBeDefined();
    expect(await repo.claimDue('filings-aapl', now + 30 * 60_000)).toBeUndefined();
  });

  it('records a missed occurrence when the policy is skip', async () => {
    const { repo } = await setup();
    await repo.saveJob(job({ nextRunAt: now - 120_000, missedRunPolicy: 'skip' }));
    let executions = 0;
    await new BackgroundJobScheduler(repo, { run: async () => { executions += 1; return {}; } }, { now: () => now }).tick();
    expect(executions).toBe(0);
    expect((await repo.listRuns())[0]?.status).toBe('missed');
  });

  it('retries within bounds and persists a privacy-safe failure notification', async () => {
    const { repo } = await setup();
    await repo.saveJob(job());
    let attempts = 0;
    await new BackgroundJobScheduler(repo, { run: async () => { attempts += 1; throw new Error('private portfolio AAPL quantity 99'); } }, { now: () => now, wait: async () => undefined }).tick();
    expect(attempts).toBe(2);
    expect((await repo.listRuns())[0]).toMatchObject({ status: 'failed', attempts: 2 });
    const notification = (await repo.listNotifications())[0];
    expect(notification?.kind).toBe('failed');
    expect(notification?.message).toBe('Open Folio for details.');
    expect(notification?.message).not.toContain('AAPL');
  });

  it('redacts credential-shaped failure previews even when requested', async () => {
    const { repo } = await setup();
    await repo.saveJob(job({ notificationPolicy: { onSuccess: true, onFailure: true, sensitivePreview: true } }));
    await new BackgroundJobScheduler(repo, { run: async () => { throw new Error('GET https://api.example.test?q=1&api_key=sk-secret-12345678'); } }, { now: () => now, wait: async () => undefined }).tick();
    const notification = (await repo.listNotifications())[0];
    expect(notification?.message).not.toContain('sk-secret-12345678');
    expect(notification?.message).toContain('<REDACTED>');
  });

  it('can disable and delete a recurring job', async () => {
    const { repo } = await setup();
    await repo.saveJob(job());
    expect((await repo.setEnabled('filings-aapl', false))?.enabled).toBe(false);
    await repo.removeJob('filings-aapl');
    expect(await repo.listJobs()).toEqual([]);
  });

  it('rejects invalid intervals and safely ignores unknown or future jobs', async () => {
    const { repo } = await setup();
    expect(repo.saveJob(job({ schedule: { intervalMs: 0 } }))).rejects.toThrow('interval must be positive');
    expect(await repo.setEnabled('missing', false)).toBeUndefined();
    await repo.saveJob(job({ nextRunAt: now + 60_000 }));
    expect(await repo.claimDue('filings-aapl', now)).toBeUndefined();
    expect(await repo.claimDue('missing', now)).toBeUndefined();
  });

  it('emits a digest notification through the callback after persistence', async () => {
    const { repo } = await setup();
    await repo.saveJob(job({ type: 'watchlist-digest', notificationPolicy: { onSuccess: true, onFailure: true, sensitivePreview: true } }));
    const delivered: string[] = [];
    await new BackgroundJobScheduler(repo, { run: async () => ({ notificationKind: 'digest-ready' }) }, {
      now: () => now,
      notify: async (notification) => { delivered.push(notification.kind); expect((await repo.listNotifications())[0]?.id).toBe(notification.id); },
    }).tick();
    expect(delivered).toEqual(['digest-ready']);
    expect((await repo.listNotifications())[0]).toMatchObject({ kind: 'digest-ready', message: 'watchlist-digest is ready' });
  });
});

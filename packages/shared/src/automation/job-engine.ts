import { randomUUID } from 'node:crypto';
import type { BackgroundJob, BackgroundJobRun, StoredNotification } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

interface JobFile {
  jobs: BackgroundJob[];
  runs: BackgroundJobRun[];
  notifications: StoredNotification[];
  claims: Record<string, { runId: string; leaseUntil: number }>;
}

const EMPTY: JobFile = { jobs: [], runs: [], notifications: [], claims: {} };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Atomic-in-process persistence for scheduler state and its notification center. */
export class BackgroundJobRepository {
  private static readonly FILE = 'automation/background-jobs.json';
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store: JsonFileStore) {}

  private read(): Promise<JobFile> {
    return this.store.read<JobFile>(BackgroundJobRepository.FILE, clone(EMPTY));
  }

  private mutate<T>(operation: (file: JobFile) => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(async () => {
      try {
        const file = await this.read();
        const result = await operation(file);
        await this.store.write(BackgroundJobRepository.FILE, file);
        return result;
      } finally {
        release();
      }
    });
  }

  async listJobs(): Promise<BackgroundJob[]> { return (await this.read()).jobs; }
  async listRuns(jobId?: string): Promise<BackgroundJobRun[]> {
    const runs = (await this.read()).runs;
    return jobId ? runs.filter((run) => run.jobId === jobId) : runs;
  }
  async listNotifications(): Promise<StoredNotification[]> { return (await this.read()).notifications; }

  saveJob(job: BackgroundJob): Promise<BackgroundJob> {
    return this.mutate((file) => {
      if (!Number.isFinite(job.schedule.intervalMs) || job.schedule.intervalMs <= 0) throw new Error('Job interval must be positive');
      file.jobs = [clone(job), ...file.jobs.filter((item) => item.id !== job.id)];
      return job;
    });
  }

  removeJob(jobId: string): Promise<void> {
    return this.mutate((file) => { file.jobs = file.jobs.filter((job) => job.id !== jobId); delete file.claims[jobId]; });
  }

  setEnabled(jobId: string, enabled: boolean): Promise<BackgroundJob | undefined> {
    return this.mutate((file) => {
      const job = file.jobs.find((item) => item.id === jobId);
      if (!job) return undefined;
      job.enabled = enabled;
      return clone(job);
    });
  }

  /** Claim is serialized so concurrent ticks cannot launch the same occurrence twice. */
  /** The lease must outlive the Electron research deadline to avoid duplicate work. */
  claimDue(jobId: string, now: number, leaseMs = 45 * 60_000): Promise<{ job: BackgroundJob; runId: string } | undefined> {
    return this.mutate((file) => {
      const job = file.jobs.find((item) => item.id === jobId);
      const current = file.claims[jobId];
      if (!job?.enabled || job.nextRunAt > now || (current && current.leaseUntil > now)) return undefined;
      const runId = randomUUID();
      file.claims[jobId] = { runId, leaseUntil: now + leaseMs };
      job.status = 'running';
      return { job: clone(job), runId };
    });
  }

  finish(job: BackgroundJob, run: BackgroundJobRun, notification?: StoredNotification): Promise<void> {
    return this.mutate((file) => {
      const stored = file.jobs.find((item) => item.id === job.id);
      if (!stored) return;
      stored.status = run.status;
      stored.lastRunAt = run.finishedAt;
      stored.lastRunId = run.id;
      stored.nextRunAt = Math.max(job.nextRunAt + job.schedule.intervalMs, run.finishedAt + job.schedule.intervalMs);
      delete file.claims[job.id];
      file.runs = [run, ...file.runs.filter((item) => item.id !== run.id)];
      if (notification) file.notifications = [notification, ...file.notifications];
    });
  }

  recordMissed(job: BackgroundJob, now: number): Promise<void> {
    const run: BackgroundJobRun = { id: randomUUID(), jobId: job.id, status: 'missed', scheduledFor: job.nextRunAt, finishedAt: now, attempts: 0 };
    return this.finish(job, run);
  }
}

export interface BackgroundJobExecutor {
  run(job: BackgroundJob): Promise<{ productionRunId?: string; notificationKind?: StoredNotification['kind'] }>;
}

export class BackgroundJobScheduler {
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    private readonly repository: BackgroundJobRepository,
    private readonly executor: BackgroundJobExecutor,
    private readonly options: { now?: () => number; wait?: (ms: number) => Promise<void>; notify?: (notification: StoredNotification) => void | Promise<void> } = {}
  ) {
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async tick(): Promise<void> {
    const now = this.options.now?.() ?? Date.now();
    for (const job of await this.repository.listJobs()) {
      if (!job.enabled || job.nextRunAt > now) continue;
      if (job.missedRunPolicy === 'skip' && now - job.nextRunAt >= job.schedule.intervalMs) {
        await this.repository.recordMissed(job, now);
        continue;
      }
      const claim = await this.repository.claimDue(job.id, now);
      if (!claim) continue;
      await this.execute(claim.job, claim.runId, now);
    }
  }

  private async execute(job: BackgroundJob, runId: string, startedAt: number): Promise<void> {
    let error: unknown;
    for (let attempt = 1; attempt <= job.retryPolicy.maxAttempts; attempt += 1) {
      try {
        const result = await this.executor.run(job);
        const finishedAt = this.options.now?.() ?? Date.now();
        const run: BackgroundJobRun = { id: runId, jobId: job.id, status: 'succeeded', scheduledFor: job.nextRunAt, startedAt, finishedAt, attempts: attempt, productionRunId: result.productionRunId };
        const notification = job.notificationPolicy.onSuccess
          ? this.notification(job, run, result.notificationKind ?? (job.type === 'filing-check' ? 'filing-found' : 'completed')) : undefined;
        await this.repository.finish(job, run, notification);
        if (notification) await this.options.notify?.(notification);
        return;
      } catch (caught) {
        error = caught;
        if (attempt < job.retryPolicy.maxAttempts) {
          const backoff = Math.min(job.retryPolicy.initialBackoffMs * 2 ** (attempt - 1), job.retryPolicy.maxBackoffMs);
          await this.wait(backoff);
        }
      }
    }
    const finishedAt = this.options.now?.() ?? Date.now();
    const run: BackgroundJobRun = { id: runId, jobId: job.id, status: 'failed', scheduledFor: job.nextRunAt, startedAt, finishedAt, attempts: job.retryPolicy.maxAttempts, error: safeErrorPreview(error) };
    const notification = job.notificationPolicy.onFailure ? this.notification(job, run, 'failed') : undefined;
    await this.repository.finish(job, run, notification);
    if (notification) await this.options.notify?.(notification);
  }

  private notification(job: BackgroundJob, run: BackgroundJobRun, kind: StoredNotification['kind']): StoredNotification {
    const failed = kind === 'failed';
    return {
      id: `notification-${run.id}`, jobId: job.id, runId: run.id, kind,
      title: failed ? 'Research needs attention' : job.type === 'filing-check' ? 'New filing found' : 'Research complete',
      message: job.notificationPolicy.sensitivePreview ? (failed ? run.error ?? 'Task failed' : `${job.type} is ready`) : (failed ? 'Open Folio for details.' : 'Open Folio to view the result.'),
      createdAt: run.finishedAt,
      deepLink: run.productionRunId ? `/runs/${encodeURIComponent(run.productionRunId)}` : `/jobs/${encodeURIComponent(job.id)}`,
    };
  }
}

function safeErrorPreview(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Background task failed';
  return message
    .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret)=)[^&#\s]+/gi, '$1<REDACTED>')
    .replace(/\b(?:sk|api|token|canary)[-_][A-Za-z0-9_-]{8,}\b/g, '<REDACTED>')
    .slice(0, 500);
}

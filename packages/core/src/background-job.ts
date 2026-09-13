import type { ContextSelection } from './portfolio-context.ts';

export type BackgroundJobType = 'research' | 'watchlist-digest' | 'filing-check';
export type BackgroundJobStatus = 'scheduled' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'missed';
export type MissedRunPolicy = 'catch-up' | 'skip';

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  enabled: boolean;
  schedule: { intervalMs: number };
  input: Record<string, unknown>;
  targetContext?: ContextSelection;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  status: BackgroundJobStatus;
  retryPolicy: { maxAttempts: number; initialBackoffMs: number; maxBackoffMs: number };
  missedRunPolicy: MissedRunPolicy;
  notificationPolicy: { onSuccess: boolean; onFailure: boolean; sensitivePreview: boolean };
}

export interface BackgroundJobRun {
  id: string;
  jobId: string;
  status: BackgroundJobStatus;
  scheduledFor: number;
  startedAt?: number;
  finishedAt: number;
  attempts: number;
  productionRunId?: string;
  error?: string;
}

export interface StoredNotification {
  id: string;
  jobId: string;
  runId: string;
  kind: 'completed' | 'failed' | 'digest-ready' | 'filing-found';
  title: string;
  message: string;
  createdAt: number;
  readAt?: number;
  /** App route only. Never an arbitrary external URL. */
  deepLink: string;
}

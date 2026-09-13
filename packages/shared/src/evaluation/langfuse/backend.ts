// Langfuse EvaluationBackend + run exporter (issue #14).
import type { PrivacyLevel, TraceReference } from '@finagent/core';
import type {
  BackendStatus,
  EvaluationBackend,
  EvaluationBackendKind,
  FetchLike,
  TraceMatch,
  TraceQuery,
} from '../backend.ts';
import { LangfuseClient } from './client.ts';
import {
  buildAgentTraceBatch,
  buildResearchTraceBatch,
  type AgentRunTraceSnapshot,
  type ResearchRunTraceSnapshot,
} from './exporter.ts';
import { normalizeLangfuseHost } from './metadata.ts';
import type { LangfuseScoreInput } from './protocol.ts';

export interface LangfuseBackendOptions {
  publicKey: string;
  secretKey: string;
  host?: string;
  fetchImpl?: FetchLike;
  privacyLevel?: PrivacyLevel;
  now?: () => number;
}

interface RememberedTrace {
  traceId: string;
  startTime: number;
  sessionId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export class LangfuseEvaluationBackend implements EvaluationBackend {
  readonly kind: EvaluationBackendKind = 'langfuse';
  readonly client: LangfuseClient;
  private readonly privacyLevel: PrivacyLevel;
  private readonly now: () => number;
  private readonly memory: RememberedTrace[] = [];
  private lastError?: string;

  constructor(options: LangfuseBackendOptions) {
    this.client = new LangfuseClient({
      publicKey: options.publicKey,
      secretKey: options.secretKey,
      host: options.host,
      fetchImpl: options.fetchImpl,
    });
    this.privacyLevel = options.privacyLevel ?? 'standard';
    this.now = options.now ?? Date.now;
  }

  get lastErrorDetails(): string | undefined {
    return this.lastError ?? this.client.lastErrorDetails;
  }

  async status(): Promise<BackendStatus> {
    const health = await this.client.health();
    if (!health.available) this.lastError = health.message;
    return {
      kind: 'langfuse',
      available: health.available,
      endpoint: this.client.host,
      message: health.message,
    };
  }

  async findTraces(query: TraceQuery): Promise<TraceMatch[]> {
    const local = this.memory.filter((entry) => {
      if (query.sessionId && entry.sessionId !== query.sessionId) return false;
      if (query.threadId && entry.threadId !== query.threadId) return false;
      if (query.startedAfter !== undefined && entry.startTime < query.startedAfter) return false;
      if (query.startedBefore !== undefined && entry.startTime > query.startedBefore) return false;
      return true;
    });
    if (local.length > 0) {
      return local.slice(-(query.limit ?? 50)).map((entry) => ({
        traceId: entry.traceId,
        startTime: entry.startTime,
        metadata: entry.metadata,
      }));
    }
    try {
      const remote = await this.client.listTraces({
        sessionId: query.sessionId ?? query.threadId,
        fromTimestamp: query.startedAfter !== undefined ? new Date(query.startedAfter).toISOString() : undefined,
        toTimestamp: query.startedBefore !== undefined ? new Date(query.startedBefore).toISOString() : undefined,
        limit: query.limit ?? 50,
      });
      return remote
        .map((trace) => {
          const startTime = trace.timestamp ? Date.parse(trace.timestamp) : NaN;
          return {
            traceId: trace.id,
            startTime: Number.isNaN(startTime) ? 0 : startTime,
            metadata: trace.metadata,
          };
        })
        .filter((trace) => trace.traceId);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  traceUrl(traceId: string): string | undefined {
    if (!traceId) return undefined;
    return this.client.traceUrl(traceId);
  }

  async submitFeedback(traceId: string, feedback: { score: number; comment?: string; runId?: string }): Promise<void> {
    const result = await this.client.addScores(traceId, [
      { name: 'human', value: feedback.score, comment: feedback.comment ?? feedback.runId },
    ]);
    if (!result.ok) this.lastError = result.error;
  }

  async submitScores(traceId: string, scores: LangfuseScoreInput[]): Promise<void> {
    const result = await this.client.addScores(traceId, scores);
    if (!result.ok) this.lastError = result.error;
  }

  async exportAgentRun(snapshot: AgentRunTraceSnapshot): Promise<TraceReference> {
    const batch = buildAgentTraceBatch(snapshot, this.privacyLevel);
    return this.flush(batch.traceId, batch.events, snapshot.startedAt, snapshot.sessionId, snapshot.threadId, snapshot.metadata);
  }

  async exportResearchRun(snapshot: ResearchRunTraceSnapshot): Promise<TraceReference> {
    const batch = buildResearchTraceBatch(snapshot, this.privacyLevel);
    return this.flush(
      batch.traceId,
      batch.events,
      snapshot.startedAt,
      snapshot.metadata.folioSessionId,
      snapshot.metadata.threadId,
      snapshot.metadata
    );
  }

  private async flush(
    traceId: string,
    events: ReturnType<typeof buildAgentTraceBatch>['events'],
    startTime: number,
    sessionId: string | undefined,
    threadId: string | undefined,
    metadata: Record<string, unknown> | object
  ): Promise<TraceReference> {
    const fallback: TraceReference = {
      backend: 'langfuse',
      traceId,
      sessionId,
      threadId,
      runId: typeof (metadata as { folioRunId?: string }).folioRunId === 'string'
        ? (metadata as { folioRunId: string }).folioRunId
        : traceId,
      url: this.traceUrl(traceId),
    };
    try {
      const result = await this.client.ingest(events);
      if (!result.ok) {
        this.lastError = result.error;
        return { ...fallback, backend: 'langfuse' };
      }
      this.memory.push({
        traceId: result.traceId ?? traceId,
        startTime,
        sessionId,
        threadId,
        metadata: metadata as Record<string, unknown>,
      });
      return { ...fallback, traceId: result.traceId ?? traceId };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return fallback;
    }
  }
}

export function parseLangfuseCredential(raw: string | undefined): { publicKey: string; secretKey: string } | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { publicKey?: unknown; secretKey?: unknown };
      if (typeof parsed.publicKey === 'string' && typeof parsed.secretKey === 'string') {
        const publicKey = parsed.publicKey.trim();
        const secretKey = parsed.secretKey.trim();
        if (publicKey && secretKey) return { publicKey, secretKey };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  const split = trimmed.indexOf('|');
  if (split > 0) {
    const publicKey = trimmed.slice(0, split).trim();
    const secretKey = trimmed.slice(split + 1).trim();
    if (publicKey && secretKey) return { publicKey, secretKey };
  }
  return undefined;
}

export function serializeLangfuseCredential(publicKey: string, secretKey: string): string {
  return JSON.stringify({ publicKey: publicKey.trim(), secretKey: secretKey.trim() });
}

export function langfuseCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  publicKey: string;
  secretKey: string;
  host: string;
} | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return undefined;
  return { publicKey, secretKey, host: normalizeLangfuseHost(env.LANGFUSE_HOST) };
}

export function isLangfuseTracingEnabled(
  settings: { langfuseTracingEnabled?: boolean },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (settings.langfuseTracingEnabled === true) return true;
  const flag = env.LANGFUSE_TRACING?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true;
  return false;
}

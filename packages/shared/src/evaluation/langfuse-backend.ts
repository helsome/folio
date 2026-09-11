import type { EvaluationBackend, BackendStatus, TraceQuery, TraceMatch, FetchLike } from './backend.ts';

/**
 * Langfuse evaluation backend (issue #14).
 *
 * Implements the EvaluationBackend contract for Langfuse cloud / self-hosted.
 * Uses Basic Auth (public key + secret key) instead of LangSmith's x-api-key.
 *
 * Failure-isolated: all methods degrade gracefully and never throw into
 * the agent execution path (spec §87).
 */

const DEFAULT_LANGFUSE_HOST = 'https://cloud.langfuse.com';

export type LangfuseBackendKind = 'langfuse';

export interface LangfuseBackendOptions {
  publicKey: string;
  secretKey: string;
  project?: string;
  host?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface LangfuseTrace {
  id: string;
  timestamp: string;
  name?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export class LangfuseEvaluationBackend implements EvaluationBackend {
  readonly kind: 'langfuse' = 'langfuse';
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly host: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private lastError?: string;

  constructor(options: LangfuseBackendOptions) {
    this.publicKey = options.publicKey;
    this.secretKey = options.secretKey;
    this.host = (options.host ?? DEFAULT_LANGFUSE_HOST).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<BackendStatus> {
    try {
      // Langfuse health check: GET /api/public/health
      const response = await this.request('/api/public/health', { method: 'GET' });
      if (!response.ok) {
        throw new Error(`Langfuse health check failed: ${response.status}`);
      }
      return {
        kind: 'langfuse',
        available: true,
        endpoint: this.host,
        message: 'Connected to Langfuse.',
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        kind: 'langfuse',
        available: false,
        endpoint: this.host,
        message: this.lastError,
      };
    }
  }

  async findTraces(query: TraceQuery): Promise<TraceMatch[]> {
    try {
      const params = new URLSearchParams();
      if (query.startedAfter !== undefined) {
        params.set('fromTimestamp', String(Math.floor(query.startedAfter / 1000)));
      }
      if (query.startedBefore !== undefined) {
        params.set('toTimestamp', String(Math.floor(query.startedBefore / 1000)));
      }
      if (query.limit !== undefined) {
        params.set('limit', String(query.limit));
      }
      if (query.sessionId) {
        params.set('sessionId', query.sessionId);
      }

      const response = await this.request(`/api/public/traces?${params.toString()}`, {
        method: 'GET',
      });
      if (!response.ok) return [];

      const data = (await response.json()) as { data?: LangfuseTrace[] };
      const traces = data.data ?? [];

      const matches: TraceMatch[] = [];
      for (const trace of traces) {
        // Filter by threadId if provided (Langfuse uses userId or metadata.thread_id)
        if (query.threadId) {
          const traceThreadId =
            trace.metadata?.thread_id ?? trace.userId;
          if (traceThreadId !== query.threadId) continue;
        }
        const startTime = trace.timestamp ? Date.parse(trace.timestamp) : NaN;
        if (Number.isNaN(startTime)) continue;
        matches.push({
          traceId: trace.id,
          startTime,
          metadata: trace.metadata,
        });
      }
      return matches;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  async submitFeedback(
    traceId: string,
    feedback: { score: number; comment?: string; runId?: string }
  ): Promise<void> {
    try {
      await this.request(`/api/public/scores`, {
        method: 'POST',
        body: JSON.stringify({
          traceId,
          name: 'evaluation_score',
          value: feedback.score,
          comment: feedback.comment,
          data: feedback.runId ? { folioRunId: feedback.runId } : undefined,
        }),
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      // Best-effort: feedback submission failure shouldn't break the flow
    }
  }

  traceUrl(traceId: string): string | undefined {
    return `${this.host}/trace/${traceId}`;
  }

  get lastErrorDetails(): string | undefined {
    return this.lastError;
  }

  /**
   * Send a complete trace batch to Langfuse (OTel-style ingestion).
   * Used when we want to push a full FolioTrace directly to Langfuse
   * instead of relying on the Pi runtime extension.
   */
  async sendTraceBatch(batch: {
    id: string;
    timestamp: string;
    name: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
    input?: unknown;
    output?: unknown;
    public: boolean;
  }): Promise<void> {
    try {
      await this.request('/api/public/ingestion', {
        method: 'POST',
        body: JSON.stringify({
          batch: [
            {
              id: batch.id,
              type: 'trace-create',
              timestamp: batch.timestamp,
              body: {
                id: batch.id,
                name: batch.name,
                timestamp: batch.timestamp,
                userId: batch.userId,
                sessionId: batch.sessionId,
                metadata: batch.metadata,
                input: batch.input,
                output: batch.output,
                public: batch.public,
              },
            },
          ],
        }),
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Add a score/evaluation result to a trace.
   */
  async addScore(traceId: string, name: string, value: number, comment?: string): Promise<void> {
    try {
      await this.request('/api/public/scores', {
        method: 'POST',
        body: JSON.stringify({ traceId, name, value, comment }),
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
      return await this.fetchImpl(`${this.host}${path}`, {
        ...init,
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────

import type { EvaluationBackend } from './backend.ts';
import { NoopEvaluationBackend } from './backend.ts';

/** Settings shape for Langfuse backend selection. */
export interface LangfuseSettings {
  tracingEnabled: boolean;
  traceBackend?: 'langsmith' | 'langfuse';
  langfuseHost?: string;
}

/** Credentials for Langfuse backend. */
export interface LangfuseCredentials {
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
}

/**
 * Resolve a LangfuseEvaluationBackend when configured, else Noop.
 * Use this alongside the existing LangSmith resolve logic when the user
 * selects Langfuse as their trace backend.
 */
export function resolveLangfuseBackend(
  settings: LangfuseSettings,
  credentials: LangfuseCredentials
): EvaluationBackend {
  if (!settings.tracingEnabled || settings.traceBackend !== 'langfuse') {
    return new NoopEvaluationBackend();
  }
  if (!credentials.langfusePublicKey || !credentials.langfuseSecretKey) {
    return new NoopEvaluationBackend();
  }
  return new LangfuseEvaluationBackend({
    publicKey: credentials.langfusePublicKey,
    secretKey: credentials.langfuseSecretKey,
    host: settings.langfuseHost,
  });
}

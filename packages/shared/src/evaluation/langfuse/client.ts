// Failure-isolated Langfuse REST client (issue #14).
//
// Every method swallows network/HTTP errors and returns a status object.
// Observability must never break Agent / Deep Research (spec §87).
import type { FetchLike } from '../backend.ts';
import { normalizeLangfuseHost, type LangfuseCredentials } from './metadata.ts';
import type { LangfuseIngestionEvent, LangfuseIngestionResult, LangfuseScoreInput } from './protocol.ts';

export interface LangfuseClientOptions {
  publicKey: string;
  secretKey: string;
  host?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface RequestResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

export class LangfuseClient {
  readonly host: string;
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private lastError?: string;

  constructor(options: LangfuseClientOptions) {
    this.publicKey = options.publicKey.trim();
    this.secretKey = options.secretKey.trim();
    this.host = normalizeLangfuseHost(options.host);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get lastErrorDetails(): string | undefined {
    return this.lastError;
  }

  credentials(): LangfuseCredentials {
    return { publicKey: this.publicKey, secretKey: this.secretKey, host: this.host };
  }

  async health(): Promise<{ available: boolean; message: string }> {
    const result = await this.requestJson<unknown>('/api/public/projects', { method: 'GET' });
    if (result.ok) {
      this.lastError = undefined;
      return { available: true, message: 'Connected.' };
    }
    this.lastError = result.error;
    return { available: false, message: result.error ?? 'Langfuse unreachable.' };
  }

  async ingest(events: LangfuseIngestionEvent[]): Promise<LangfuseIngestionResult> {
    if (events.length === 0) return { ok: true };
    const result = await this.requestJson<{ successes?: unknown[]; errors?: Array<{ message?: string }> }>(
      '/api/public/ingestion',
      { method: 'POST', body: { batch: events } }
    );
    if (!result.ok) {
      this.lastError = result.error;
      return { ok: false, error: result.error };
    }
    const ingestErrors = result.data?.errors ?? [];
    if (ingestErrors.length > 0) {
      const message = ingestErrors.map((entry) => entry.message ?? 'ingest error').join('; ');
      this.lastError = message;
      return { ok: false, error: message };
    }
    this.lastError = undefined;
    const traceId = findTraceId(events);
    return { ok: true, traceId };
  }

  async addScores(traceId: string, scores: LangfuseScoreInput[]): Promise<LangfuseIngestionResult> {
    if (!traceId || scores.length === 0) return { ok: true, traceId };
    const events: LangfuseIngestionEvent[] = scores.map((score) => ({
      id: crypto.randomUUID(),
      type: 'score-create',
      timestamp: new Date().toISOString(),
      body: {
        id: crypto.randomUUID(),
        traceId,
        name: score.name,
        value: score.value,
        dataType: score.dataType ?? 'NUMERIC',
        comment: score.comment,
      },
    }));
    return this.ingest(events);
  }

  async listTraces(query: {
    sessionId?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
    limit?: number;
  }): Promise<Array<{ id: string; timestamp?: string; metadata?: Record<string, unknown>; sessionId?: string }>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 50));
    if (query.sessionId) params.set('sessionId', query.sessionId);
    if (query.fromTimestamp) params.set('fromTimestamp', query.fromTimestamp);
    if (query.toTimestamp) params.set('toTimestamp', query.toTimestamp);
    const result = await this.requestJson<{
      data?: Array<{ id: string; timestamp?: string; metadata?: Record<string, unknown>; sessionId?: string }>;
    }>(`/api/public/traces?${params.toString()}`, { method: 'GET' });
    if (!result.ok) {
      this.lastError = result.error;
      return [];
    }
    return result.data?.data ?? [];
  }

  traceUrl(traceId: string): string {
    const origin = this.host.includes('cloud.langfuse.com') ? 'https://cloud.langfuse.com' : this.host;
    return `${origin}/trace/${encodeURIComponent(traceId)}`;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.publicKey}:${this.secretKey}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  private async requestJson<T>(path: string, init: { method: string; body?: Record<string, unknown> }): Promise<RequestResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.host}${path}`, {
        method: init.method,
        headers: {
          authorization: this.authHeader(),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
          ok: false,
          status: response.status,
          error: `Langfuse API ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`,
        };
      }
      if (response.status === 204) return { ok: true, status: 204 };
      const data = (await response.json()) as T;
      return { ok: true, status: response.status, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message === 'This operation was aborted' ? 'Langfuse request timed out.' : message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function findTraceId(events: LangfuseIngestionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === 'trace-create' && typeof event.body.id === 'string') return event.body.id;
    if (typeof event.body.traceId === 'string') return event.body.traceId;
  }
  return undefined;
}

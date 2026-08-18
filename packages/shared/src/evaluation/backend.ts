// Provider-neutral evaluation backend (spec §15-16, §87, §89).
//
// Folio core only depends on `EvaluationBackend`. LangSmith is the first
// implementation; local and disabled backends cover offline/dev modes.
// Every backend MUST be failure-isolated: observability must never break the
// agent (spec §87), so backend methods return statuses/lists instead of
// throwing into agent execution paths.
import type { TraceReference } from '@finagent/core';

export type EvaluationBackendKind = 'langsmith' | 'local' | 'none';

export interface TraceQuery {
  /** Pi session id = LangSmith thread_id when known. */
  threadId?: string;
  /** Folio session id (local backends). */
  sessionId?: string;
  /** Only traces that started at/after this epoch-ms timestamp. */
  startedAfter?: number;
  /** Only traces that started at/before this epoch-ms timestamp. */
  startedBefore?: number;
  limit?: number;
}

export interface TraceMatch {
  traceId: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}

export interface BackendStatus {
  kind: EvaluationBackendKind;
  available: boolean;
  message?: string;
  project?: string;
  endpoint?: string;
}

export interface EvaluationBackend {
  readonly kind: EvaluationBackendKind;
  /** Connection/config probe; never throws. */
  status(): Promise<BackendStatus>;
  /** Find traces in a time window matching a thread/session; [] on failure. */
  findTraces(query: TraceQuery): Promise<TraceMatch[]>;
  /** Best-effort UI link for a trace id; undefined when unknown. */
  traceUrl?(traceId: string): string | undefined;
  /** Record human/automated feedback for a trace (spec §82). */
  submitFeedback?(traceId: string, feedback: { score: number; comment?: string; runId?: string }): Promise<void>;
}

// ── Disabled / local backends ───────────────────────────────────────────────

export class NoopEvaluationBackend implements EvaluationBackend {
  readonly kind: EvaluationBackendKind = 'none';
  async status(): Promise<BackendStatus> {
    return { kind: 'none', available: true, message: 'Tracing disabled.' };
  }
  async findTraces(): Promise<TraceMatch[]> {
    return [];
  }
}

/** In-app trace store: records runs locally instead of uploading anywhere. */
export class LocalEvaluationBackend implements EvaluationBackend {
  readonly kind: EvaluationBackendKind = 'local';
  readonly memory: Array<{
    traceId: string;
    startTime: number;
    sessionId?: string;
    threadId?: string;
    metadata?: Record<string, unknown>;
  }> = [];

  async status(): Promise<BackendStatus> {
    return { kind: 'local', available: true, message: 'Local-only evaluation mode.' };
  }
  async findTraces(query: TraceQuery): Promise<TraceMatch[]> {
    let matches = this.memory.filter((link) => {
      if (query.sessionId && link.sessionId !== query.sessionId) return false;
      if (query.threadId && link.threadId !== query.threadId) return false;
      if (query.startedAfter !== undefined && link.startTime < query.startedAfter) return false;
      if (query.startedBefore !== undefined && link.startTime > query.startedBefore) return false;
      return true;
    });
    if (query.limit !== undefined && query.limit > 0) {
      matches = matches.slice(-query.limit);
    }
    return matches.map((link) => ({ traceId: link.traceId, startTime: link.startTime, metadata: link.metadata }));
  }

  recordLocalTrace(ref: TraceReference, startedAt: number): void {
    this.memory.push({
      traceId: `local-${ref.runId ?? Math.random().toString(36).slice(2)}`,
      startTime: startedAt,
      sessionId: ref.sessionId,
      threadId: ref.threadId,
      metadata: { local: true },
    });
  }
}

// ── LangSmith backend (minimal REST, main-process only) ────────────────────

const DEFAULT_LANGSMITH_API = 'https://api.smith.langchain.com';
const DEFAULT_LANGSMITH_UI = 'https://smith.langchain.com';

export interface LangSmithBackendOptions {
  apiKey: string;
  project: string;
  endpoint?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface LangSmithRunResource {
  id: string;
  name?: string;
  start_time?: string;
  metadata?: Record<string, unknown>;
}

export class LangSmithEvaluationBackend implements EvaluationBackend {
  readonly kind: EvaluationBackendKind = 'langsmith';
  private readonly apiKey: string;
  private readonly project: string;
  private readonly apiBase: string;
  private readonly uiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private orgId?: string;
  private lastError?: string;

  constructor(options: LangSmithBackendOptions) {
    this.apiKey = options.apiKey;
    this.project = options.project;
    const endpoint = options.endpoint?.trim() || DEFAULT_LANGSMITH_API;
    this.apiBase = endpoint.replace(/\/+$/, '');
    this.uiBase = this.deriveUiBase(this.apiBase);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private deriveUiBase(apiBase: string): string {
    if (apiBase.includes('api.smith.langchain.com')) return DEFAULT_LANGSMITH_UI;
    const origin = new URL(apiBase).origin;
    return origin;
  }

  async status(): Promise<BackendStatus> {
    try {
      const projects = await this.requestJson<{ projects?: Array<{ org_id?: string }> }>('/projects?limit=1', {});
      const list = projects?.projects ?? [];
      this.orgId = list[0]?.org_id ?? this.orgId;
      return {
        kind: 'langsmith',
        available: true,
        project: this.project,
        endpoint: this.apiBase,
        message: 'Connected.',
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        kind: 'langsmith',
        available: false,
        project: this.project,
        endpoint: this.apiBase,
        message: this.lastError,
      };
    }
  }

  async findTraces(query: TraceQuery): Promise<TraceMatch[]> {
    const filters: Record<string, unknown> = {};
    if (query.startedAfter !== undefined) filters.start_time = new Date(query.startedAfter).toISOString();
    if (query.startedBefore !== undefined) filters.end_time = new Date(query.startedBefore).toISOString();
    try {
      const body = { filters, limit: query.limit ?? 50, order: '-start_time' };
      const data = await this.requestJson<{ runs?: LangSmithRunResource[] }>('/runs/query', body);
      const runs = data?.runs ?? [];
      const matches: TraceMatch[] = [];
      for (const run of runs) {
        const metadata = run.metadata ?? {};
        const threadId = typeof metadata.thread_id === 'string' ? metadata.thread_id : undefined;
        if (query.threadId && threadId !== query.threadId) continue;
        if (!query.threadId && query.sessionId && this.sessionOf(metadata) !== query.sessionId) continue;
        const startTime = run.start_time ? Date.parse(run.start_time) : NaN;
        if (Number.isNaN(startTime)) continue;
        matches.push({ traceId: run.id, startTime, metadata });
      }
      return matches.slice(-(query.limit ?? 50));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  private sessionOf(metadata: Record<string, unknown>): string | undefined {
    const value = metadata.thread_id ?? metadata.session_id ?? metadata.sessionId;
    return typeof value === 'string' ? value : undefined;
  }

  async submitFeedback(traceId: string, feedback: { score: number; comment?: string; runId?: string }): Promise<void> {
    await this.requestJson<unknown>(`/runs/${traceId}/feedback`, {
      score: feedback.score,
      comment: feedback.comment,
      metadata: feedback.runId ? { folioRunId: feedback.runId } : undefined,
    });
  }

  traceUrl(traceId: string): string | undefined {
    if (!this.orgId) return undefined;
    return `${this.uiBase}/o/${this.orgId}/projects/p/${encodeURIComponent(this.project)}/r/${traceId}?peek=1`;
  }

  get lastErrorDetails(): string | undefined {
    return this.lastError;
  }

  private async requestJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const hasBody = body !== undefined && Object.keys(body).length > 0;
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: hasBody ? 'POST' : 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LangSmith API ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Build the backend matching current settings + credential (main process). */
export function resolveBackend(
  settings: { tracingEnabled: boolean; langsmithProject: string; langsmithEndpoint?: string },
  apiKey: string | undefined,
): EvaluationBackend {
  if (!settings.tracingEnabled || !apiKey) return new NoopEvaluationBackend();
  return new LangSmithEvaluationBackend({
    apiKey,
    project: settings.langsmithProject,
    endpoint: settings.langsmithEndpoint,
  });
}
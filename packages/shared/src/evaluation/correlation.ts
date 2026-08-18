// TraceCorrelationService (spec §14, §52-55).
//
// The Pi runtime is a persistent process, so process-level env metadata cannot
// express per-run values (folioRunId, symbol, strategy…). The LangSmith
// extension stamps each trace root with `thread_id` = Pi session id and
// `turn_number`; we reconstruct the folioRunId ↔ traceId mapping after each
// run by querying the backend for traces in the run's time window, scoped to
// the session's Pi thread id. We never restart the Pi process per run (§55).
//
// Failures are isolated: any backend/network error degrades to `none` and is
// recorded as an observability error instead of breaking the agent (§87).
import type { SupportedLocale, TraceReference } from '@finagent/core';
import type { EvaluationBackend, TraceMatch } from './backend.ts';
import { type TraceLinkRecord, EvaluationStore } from './store.ts';

export interface TraceCorrelationOptions {
  backend: EvaluationBackend;
  store: EvaluationStore;
  now?: () => number;
}

export interface TraceCorrelationInput {
  folioRunId: string;
  folioSessionId?: string;
  /** Pi session id (= LangSmith thread_id) when known. */
  threadId?: string;
  startedAt: number;
  completedAt?: number;
  /** Case/experiment runtime locale, stamped into trace metadata (spec §74). */
  locale?: SupportedLocale;
}

export class TraceCorrelationService {
  private readonly backend: EvaluationBackend;
  private readonly store: EvaluationStore;
  private readonly now: () => number;

  constructor(options: TraceCorrelationOptions) {
    this.backend = options.backend;
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  /** Resolve and persist the trace link for a finished run. Never throws. */
  async recordRun(input: TraceCorrelationInput): Promise<TraceReference> {
    const fallback: TraceReference = {
      backend: this.backend.kind === 'langsmith' ? 'langsmith' : 'none',
      sessionId: input.folioSessionId,
      threadId: input.threadId,
      runId: input.folioRunId,
      locale: input.locale,
    };
    try {
      if (this.backend.kind === 'local') {
        // Local mode: nothing to query; the local backend records its own ref.
        await this.persist(input.folioRunId, fallback);
        return fallback;
      }
      const matches = await this.backend.findTraces({
        threadId: input.threadId,
        sessionId: input.folioSessionId,
        startedAfter: input.startedAt - 60_000,
        startedBefore: (input.completedAt ?? this.now()) + 60_000,
        limit: 20,
      });
      const match = this.pickMatch(matches, input);
      const ref: TraceReference = match
        ? {
            backend: 'langsmith',
            traceId: match.traceId,
            url: this.backend.traceUrl?.(match.traceId),
            sessionId: input.folioSessionId,
            threadId: input.threadId,
            runId: input.folioRunId,
            locale: input.locale,
          }
        : fallback;
      await this.persist(input.folioRunId, ref);
      return ref;
    } catch (error) {
      await this.persist(input.folioRunId, fallback).catch(() => undefined);
      return fallback;
    }
  }

  async lookup(folioRunId: string): Promise<TraceLinkRecord | undefined> {
    return this.store.lookupTraceLink(folioRunId);
  }

  private pickMatch(matches: TraceMatch[], input: TraceCorrelationInput): TraceMatch | undefined {
    if (matches.length === 0) return undefined;
    // Latest trace whose start falls inside the run window (agent runs are the
    // only "Pi agent run" roots the extension creates per prompt).
    const candidates = matches
      .filter((m) => m.startTime >= input.startedAt - 60_000)
      .sort((a, b) => b.startTime - a.startTime);
    return candidates[0];
  }

  private async persist(runId: string, ref: TraceReference): Promise<void> {
    await this.store.recordTraceLink({ runId, traceRef: ref, recordedAt: this.now() });
  }
}
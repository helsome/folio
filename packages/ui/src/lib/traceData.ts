/**
 * Renderer-side trace data assembly (V9.1 §2–6).
 *
 * The projection itself lives in @finagent/core (pure). This module fetches
 * AUTHORITATIVE persisted sources over existing IPC and hands them to the
 * projection. It never uses current renderer atoms to reconstruct historical
 * context; live-run context is only passed explicitly when the run is
 * actually executing (source 'live').
 */
import type {
  EvaluationCase,
  EvaluationResultRecord,
  EvaluationRun,
  FolioTrace,
  Message,
  Run,
  ToolCall,
  TraceReference,
  WorkspaceContext,
} from '@finagent/core';
import { projectTrace } from '@finagent/core';
import type { FinagentClient } from '../client';

export interface SessionTraceSource {
  run: Run;
  messages: Message[];
  /** Live tool state + actual runtime context for a CURRENTLY running run. */
  liveToolCalls?: ToolCall[];
  liveContext?: Partial<WorkspaceContext>;
  traceRef?: TraceReference;
}

/** Build a FolioTrace for a session run from persisted run + transcript. */
export function projectSessionTrace(source: SessionTraceSource): FolioTrace {
  const liveContextText: Record<string, string> = {};
  if (source.liveContext) {
    const parts: string[] = [];
    if (source.liveContext.activeSymbol) parts.push(source.liveContext.activeSymbol);
    if (source.liveContext.activeView) parts.push(source.liveContext.activeView);
    if (parts.length > 0) liveContextText.workspace = parts.join(' · ');
  }
  return projectTrace({
    run: source.run,
    messages: source.messages,
    liveToolCalls: source.liveToolCalls,
    liveContext: Object.keys(liveContextText).length > 0 ? liveContextText : undefined,
    traceRef: source.traceRef,
  });
}

export interface EvaluationTraceSource {
  evaluationRun: EvaluationRun;
  evaluationResult?: EvaluationResultRecord;
  evaluationCase?: EvaluationCase;
  /** Persisted correlation lookup when traceRef was not stamped on the run. */
  traceLink?: TraceReference;
}

/** Build a FolioTrace for an evaluation run (case input is authoritative). */
export function projectEvaluationTrace(source: EvaluationTraceSource): FolioTrace {
  return projectTrace({
    evaluationRun: source.evaluationRun,
    evaluationResult: source.evaluationResult,
    evaluationCase: source.evaluationCase,
    traceRef: source.traceLink ?? source.evaluationRun.traceRef,
  });
}

/** Load persisted session sources for one run (existing kernel IPC). */
/**
 * Load persisted session sources for one run (existing kernel IPC). Also
 * resolves the persisted TraceCorrelation link (V9.1 §41): a normal Agent run
 * whose trace was correlated gets its TraceReference back so the inspector can
 * expose "Open in LangSmith" — reusing the existing store lookup, no new
 * correlation algorithm.
 */
export async function loadSessionTraceSources(
  client: FinagentClient,
  sessionId: string,
  runId: string
): Promise<SessionTraceSource | null> {
  const [runsResult, messagesResult] = await Promise.all([
    client.kernel.listRuns(sessionId),
    client.kernel.getMessages(sessionId),
  ]);
  const runs = (runsResult as { ok: boolean; data?: Run[] } | undefined)?.ok
    ? (runsResult as { data: Run[] }).data
    : [];
  const messages = (messagesResult as { ok: boolean; data?: Message[] } | undefined)?.ok
    ? (messagesResult as { data: Message[] }).data
    : [];
  const run = runs.find((entry) => entry.id === runId) ?? null;
  if (!run) return null;
  let traceRef: TraceReference | undefined;
  const linkResult = await client.evaluation?.getTraceLink({ runId });
  if (linkResult?.ok && linkResult.data?.traceRef) {
    traceRef = linkResult.data.traceRef;
  }
  return { run, messages, traceRef };
}

// TraceProjection — pure, source-neutral projection of authoritative persisted
// sources into a FolioTrace (V9.1 spec §2–4, §7, §9–11, §16).
//
// Rules enforced here:
//   - NEVER reconstruct historical context from current app state. Context
//     fields are emitted ONLY from persisted/authoritative sources; anything
//     else is `not-recorded` ("Not recorded / 未记录").
//   - Evaluation findings (judgment) are kept structurally separate from the
//     execution timeline (facts). A "missing tool" finding is never inserted
//     as a fake execution event.
//   - Completeness is derived from which sources contributed
//     (complete / partial / minimal) and never fabricated.
//   - Token budgets appear only when the runtime actually recorded them.
//   - The projection is read-only: it never persists anything.
import type {
  AgentTraceEvent,
  EvaluationCase,
  EvaluationRun,
  EvaluationResultRecord,
  Message,
  Run,
  ToolCall,
} from './index.ts';
import type { TraceReference } from './evaluation.ts';
import type { SupportedLocale } from './locale.ts';
import type {
  FolioTrace,
  TraceCompleteness,
  TraceContextField,
  TraceElementSource,
  TraceStep,
  TraceToolExecution,
} from './trace.ts';

export interface TraceProjectionInput {
  /** Persisted run record (session runs). */
  run?: Pick<
    Run,
    'id' | 'sessionId' | 'status' | 'input' | 'startedAt' | 'completedAt' | 'answer' | 'error'
  >;
  /** Transcript truth (session runs). */
  messages?: Message[];
  /** Live tool state for a run currently executing (source 'event'). */
  liveToolCalls?: ToolCall[];
  /** Live runtime context actually used by the CURRENT run (source 'live'). */
  liveContext?: Record<string, string>;
  /** Persisted evaluation run + its verdict record (source 'evaluation'). */
  evaluationRun?: EvaluationRun;
  evaluationResult?: EvaluationResultRecord;
  /** Benchmark case definition — its input is authoritative for that case. */
  evaluationCase?: EvaluationCase;
  /** Persisted trace link from TraceCorrelationService lookup. */
  traceRef?: TraceReference;
  locale?: SupportedLocale;
}

/** Latest assistant message's recorded tool calls (historical truth). */
function recordedToolCalls(messages: Message[]): Array<NonNullable<Message['toolCalls']>[number]> {
  const assistants = [...messages].reverse().filter((m) => m.role === 'assistant');
  for (const message of assistants) {
    if (message.toolCalls && message.toolCalls.length > 0) return message.toolCalls;
  }
  return [];
}

function recordedTraceEvents(messages: Message[]): AgentTraceEvent[] {
  const events: AgentTraceEvent[] = [];
  for (const message of messages) {
    if (message.trace && message.trace.length > 0) events.push(...message.trace);
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

function toolExecFromCall(
  call: { id: string; toolName: string; args?: Record<string, unknown>; startedAt: number; completedAt?: number; status: 'success' | 'error' | 'running'; result?: unknown; error?: { message: string } },
  source: TraceElementSource
): TraceToolExecution {
  const durationMs =
    call.completedAt !== undefined && call.completedAt >= call.startedAt
      ? call.completedAt - call.startedAt
      : undefined;
  let resultType: string | undefined;
  if (call.result !== undefined && call.result !== null) {
    resultType = typeof call.result === 'string' ? 'text' : typeof call.result;
  }
  return {
    id: call.id,
    toolName: call.toolName,
    status: call.status === 'running' ? 'success' : call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
    durationMs,
    args: call.args,
    resultType,
    error: call.error?.message,
    source,
  };
}

function deriveCompleteness(
  hasRun: boolean,
  tools: TraceToolExecution[],
  traceEvents: AgentTraceEvent[],
  traceRef: TraceReference | undefined
): TraceCompleteness {
  if (!hasRun) return traceRef ? 'minimal' : 'minimal';
  const hasTools = tools.length > 0;
  const hasBackendEvidence = Boolean(traceRef && traceRef.backend !== 'none');
  if (hasTools && (hasBackendEvidence || traceEvents.length > 0)) return 'complete';
  if (hasTools || traceEvents.length > 0) return 'partial';
  return 'minimal';
}

/** Workspace context recorded in the benchmark case input — authoritative (spec §9). */
function contextFromCase(caseDef: EvaluationCase): TraceContextField[] {
  const fields: TraceContextField[] = [];
  const ws = caseDef.input.workspaceContext;
  if (ws) {
    const parts: string[] = [];
    if (ws.activeSymbol) parts.push(ws.activeSymbol);
    if (ws.activeView) parts.push(ws.activeView);
    if (parts.length > 0) {
      fields.push({ key: 'workspace', value: parts.join(' · '), source: 'evaluation-input' });
    }
  }
  if (caseDef.input.strategyId) {
    fields.push({ key: 'strategy', value: caseDef.input.strategyId, source: 'evaluation-input' });
  }
  if (caseDef.input.model) {
    fields.push({ key: 'model', value: caseDef.input.model, source: 'evaluation-input' });
  }
  if (caseDef.input.provider) {
    fields.push({ key: 'provider', value: caseDef.input.provider, source: 'evaluation-input' });
  }
  return fields;
}

/**
 * Project authoritative sources into a FolioTrace. Pure and read-only; the
 * caller decides which sources exist (from persisted stores / IPC), never
 * current renderer atoms for historical runs.
 */
export function projectTrace(input: TraceProjectionInput): FolioTrace {
  const {
    run,
    messages = [],
    liveToolCalls,
    liveContext,
    evaluationRun,
    evaluationResult,
    evaluationCase,
    traceRef,
    locale,
  } = input;

  const sources = new Set<TraceElementSource>();
  if (run) sources.add('run');
  if (evaluationRun) sources.add('evaluation');
  if (messages.some((m) => (m.toolCalls?.length ?? 0) > 0)) sources.add('message');
  if (recordedTraceEvents(messages).length > 0) sources.add('trace-event');
  if (liveToolCalls && liveToolCalls.length > 0) sources.add('event');
  if (traceRef) sources.add('langsmith');

  // ── Tools: live events > recorded message calls > evaluation run record ──
  let tools: TraceToolExecution[] = [];
  if (liveToolCalls && liveToolCalls.length > 0) {
    tools = liveToolCalls.map((call) => toolExecFromCall(call, 'event'));
  } else if (evaluationRun && evaluationRun.toolCalls.length > 0) {
    tools = evaluationRun.toolCalls.map((call) => toolExecFromCall(call, 'evaluation'));
  } else {
    tools = recordedToolCalls(messages).map((call) => toolExecFromCall(call, 'message'));
  }

  const traceEvents = recordedTraceEvents(messages);
  const traceRefForOutput =
    traceRef ??
    (evaluationRun?.traceRef && evaluationRun.traceRef.backend !== 'none'
      ? evaluationRun.traceRef
      : undefined);

  // ── Timeline (facts only — judgment goes to `evaluation`) ──────────────
  const steps: TraceStep[] = [];
  if (run) {
    steps.push({
      id: `run-${run.id}`,
      kind: 'run',
      label: run.input.slice(0, 200),
      detail: run.status,
      timestamp: run.startedAt,
      status: run.status === 'failed' ? 'error' : run.status === 'completed' ? 'success' : 'running',
      source: 'run',
    });
  }
  for (const event of traceEvents) {
    steps.push({
      id: `evt-${event.id}`,
      kind: 'runtime',
      label: event.type,
      detail: event.message,
      timestamp: event.timestamp,
      source: 'trace-event',
    });
  }
  for (const tool of tools) {
    steps.push({
      id: `tool-${tool.id}`,
      kind: 'tool',
      label: tool.toolName,
      detail: tool.error,
      timestamp: tool.startedAt,
      status: tool.status === 'error' ? 'error' : 'success',
      tool,
      source: tool.source,
    });
  }
  const answer = run?.answer ?? evaluationRun?.answer;
  if (answer && answer.trim()) {
    steps.push({
      id: `answer-${run?.id ?? evaluationRun?.id ?? 'run'}`,
      kind: 'assistant',
      label: answer.slice(0, 400),
      timestamp: run?.completedAt ?? evaluationRun?.completedAt ?? 0,
      status: 'success',
      source: 'message',
    });
  }

  // ── Context: authoritative only; never current app state ────────────────
  const context: TraceContextField[] = [];
  if (evaluationCase) {
    context.push(...contextFromCase(evaluationCase));
  }
  if (liveContext && Object.keys(liveContext).length > 0) {
    for (const [key, value] of Object.entries(liveContext)) {
      context.push({ key, value, source: 'live' });
    }
  }
  // Persisted Pi session metadata (runtimeSessionId etc.) is authoritative
  // when the run record carries it.
  if (run?.sessionId) {
    context.push({ key: 'session', value: run.sessionId, source: 'recorded' });
  }
  if (traceRefForOutput?.threadId) {
    context.push({ key: 'thread', value: traceRefForOutput.threadId, source: 'recorded' });
  }
  // Honest absence: a session run never records a workspace context today.
  if (!evaluationCase && !liveContext) {
    context.push({ key: 'workspace', value: '', source: 'not-recorded' });
  }

  // ── Evaluation findings (judgment, kept separate) ───────────────────────
  let evaluation: FolioTrace['evaluation'];
  if (evaluationRun || evaluationResult) {
    const expected = evaluationCase?.expected.requiredCapabilities ?? evaluationCase?.expected.optionalCapabilities;
    const actual = tools.map((tool) => tool.toolName);
    const rawVerdict = evaluationResult?.verdict ?? 'fail';
    evaluation = {
      verdict: rawVerdict === 'pass' ? 'pass' : rawVerdict === 'fail' ? 'fail' : 'partial',
      failureMode: evaluationRun?.failureModes[0],
      detail: evaluationResult?.notes,
      expected,
      actual,
      metricScores: evaluationResult?.scores.map((score) => ({
        metric: score.metric,
        score: score.score,
        reason: score.reason,
      })),
    };
  }

  const startedAt = run?.startedAt ?? evaluationRun?.startedAt ?? 0;
  const completedAt = run?.completedAt ?? evaluationRun?.completedAt;
  const latencyMs =
    completedAt !== undefined && completedAt >= startedAt
      ? completedAt - startedAt
      : evaluationRun?.latencyMs;

  return {
    runId: run?.id ?? evaluationRun?.id ?? 'run',
    sessionId: run?.sessionId ?? evaluationRun?.traceRef?.sessionId,
    status:
      run?.status === 'running'
        ? 'running'
        : evaluationRun
          ? evaluationRun.status === 'failed' || evaluationRun.status === 'timeout'
            ? 'failed'
            : 'completed'
          : (run?.status ?? 'completed'),
    startedAt,
    completedAt,
    latencyMs,
    input: run?.input ?? evaluationRun?.answer ?? '',
    answer,
    error: run?.error?.message ?? evaluationRun?.error?.message,
    completeness: deriveCompleteness(Boolean(run || evaluationRun), tools, traceEvents, traceRefForOutput),
    sources: [...sources],
    tools,
    steps,
    context,
    evaluation,
    traceRef: traceRefForOutput,
    budget: undefined,
    locale,
  };
}

/** Token budget was never recorded by the current runtimes — always absent. */
export const TRACE_BUDGET_NOT_RECORDED = true;

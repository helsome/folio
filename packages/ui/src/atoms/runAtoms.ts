import { atom } from 'jotai';
import type {
  AgentEvent,
  ApiError,
  Message,
  StopReason,
  ToolCall,
  WorkspaceContext,
} from '@finagent/core';
import { isRuntimeInfraCode } from '@finagent/core';
import type { FinagentClient } from '../client';
import { activeSessionIdAtom, messagesAtomFamily, sessionsAtom } from './sessionAtoms';

/** Live view of the currently executing run, streamed from kernel events. */
export interface RunView {
  runId: string;
  sessionId: string;
  answer: string;
  toolCalls: ToolCall[];
  error?: ApiError;
  /** V8.1 §38: set when the run terminated as a runtime infrastructure failure
   * (Pi process unavailable). The panel shows a dedicated banner instead of a
   * chat message; cleared on the next run. */
  infraError?: ApiError;
}

/**
 * Summary of the most recent finished run (V9.1 §12). Powers the AgentPanel
 * footer's Trace affordance. `workspaceContext` is captured at startRun for
 * LIVE runs only (the actual context that run started with) — never
 * reconstructed from current atoms for historical runs.
 */
export interface LastRunSummary {
  runId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  toolCount: number;
  workspaceContext?: WorkspaceContext;
  /** Structured guard information retained for the run footer. */
  stopReason?: GuardStopReason;
  stopDetail?: GuardStopDetail;
}

export const lastRunSummaryAtom = atom<LastRunSummary | null>(null);

export const runViewAtom = atom<RunView | null>(null);

/** Codes the run-budget guard sets on `run_failed` (#17): a guard stop is not an error. */
const GUARD_STOP_CODES = new Set(['BUDGET_EXHAUSTED', 'LOOP_DETECTED', 'RETRY_STORM']);

export type GuardStopReason = Extract<StopReason, 'budget_exhausted' | 'loop_detected' | 'retry_storm'>;

export interface GuardStopDetail {
  key?: string;
  limit?: number;
  used?: number;
  signal?: string;
  tool?: string;
  count?: number;
}

/**
 * One line explaining a guard stop, plus the numbers the runtime attached to it.
 * Returns undefined for ordinary failures, which keep the raw error message.
 */
export function describeGuardStop(error: ApiError): string | undefined {
  const guardStop = getGuardStopInfo(error);
  if (guardStop === undefined) return undefined;
  const reason =
    error.code === 'BUDGET_EXHAUSTED'
      ? 'the run budget was used up'
      : error.code === 'LOOP_DETECTED'
        ? 'a repeating loop was detected'
        : 'the run retried too often in a row';
  return `Stopped early: ${reason}${describeGuardDetail(guardStop.detail)}. The messages above are what it completed.`;
}

/** Extract the stable stop reason and the small allowlist of details the UI may display. */
export function getGuardStopInfo(error: ApiError):
  | { reason: GuardStopReason; detail?: GuardStopDetail }
  | undefined {
  if (!GUARD_STOP_CODES.has(error.code)) return undefined;
  const reason: GuardStopReason =
    error.code === 'BUDGET_EXHAUSTED'
      ? 'budget_exhausted'
      : error.code === 'LOOP_DETECTED'
        ? 'loop_detected'
        : 'retry_storm';
  return { reason, detail: parseGuardDetail(error.message) };
}

/** The detail JSON the kernel appends to a guard stop message, when it parses. */
function parseGuardDetail(message: string): GuardStopDetail | undefined {
  const start = message.indexOf('{');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(message.slice(start)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const detail: GuardStopDetail = {};
    if (typeof record.key === 'string') detail.key = record.key;
    if (typeof record.limit === 'number' && Number.isFinite(record.limit)) detail.limit = record.limit;
    if (typeof record.used === 'number' && Number.isFinite(record.used)) detail.used = record.used;
    if (typeof record.signal === 'string') detail.signal = record.signal;
    if (typeof record.tool === 'string') detail.tool = record.tool;
    if (typeof record.count === 'number' && Number.isFinite(record.count)) detail.count = record.count;
    return Object.keys(detail).length > 0 ? detail : undefined;
  } catch {
    return undefined;
  }
}

/** Render the two shapes a guard detail takes: a budget key, or a repeated signal. */
function describeGuardDetail(detail: GuardStopDetail | undefined): string {
  if (detail === undefined) return '';
  if (typeof detail.key === 'string' && detail.used !== undefined && detail.limit !== undefined) {
    return ` (${detail.key} ${detail.used}/${detail.limit})`;
  }
  if (typeof detail.tool === 'string' && detail.count !== undefined) {
    return ` (${detail.tool} repeated ${detail.count}×)`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Agent event reducer: the kernel is the source of truth; the atoms below are
// pure projections of the `agent:event` stream.
// ---------------------------------------------------------------------------

export const applyAgentEventAtom = atom(
  null,
  (get, set, event: AgentEvent) => {
    const sessionId = event.sessionId;

    // Research/thesis/portfolio synthesis uses the same kernel event bus as
    // the visible copilot. Only project events for the active conversation
    // into the chat UI; internal throwaway sessions must stay silent.
    if (get(activeSessionIdAtom) !== sessionId) return;

    const messages = messagesAtomFamily(sessionId);

    if (event.type === 'run_started') {
      // Kernel persists the user message; surface it in the UI here.
      set(messages, [...get(messages), event.payload.userMessage]);
      set(sessionsAtom, (sessions) => sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'running' as const, messageCount: session.messageCount + 1 } : session
      ));
      set(runViewAtom, {
        runId: event.runId,
        sessionId,
        answer: '',
        toolCalls: [],
        infraError: undefined,
      });
      set(lastRunSummaryAtom, {
        runId: event.runId,
        sessionId,
        status: 'running',
        startedAt: event.payload.run.startedAt,
        toolCount: 0,
        // Preserve the live context captured by the AgentPanel at startRun.
        workspaceContext: get(lastRunSummaryAtom)?.workspaceContext,
      });
      return;
    }

    const run = get(runViewAtom);
    if (!run || run.runId !== event.runId || run.sessionId !== sessionId) return;

    if (event.type === 'message_delta') {
      set(runViewAtom, { ...run, answer: event.payload.answer });
      return;
    }

    if (event.type === 'tool_started') {
      set(runViewAtom, {
        ...run,
        toolCalls: [...run.toolCalls.filter((toolCall) => toolCall.id !== event.payload.toolCall.id), event.payload.toolCall],
      });
      return;
    }

    if (event.type === 'tool_completed') {
      set(runViewAtom, {
        ...run,
        toolCalls: run.toolCalls.map((toolCall) =>
          toolCall.id === event.payload.toolCall.id ? event.payload.toolCall : toolCall
        ),
      });
      return;
    }

    if (event.type === 'message_started') {
      return;
    }

    if (event.type === 'message_completed') {
      set(runViewAtom, { ...run, answer: event.payload.answer });
      return;
    }

    // Terminal events: finalize the assistant message and clear the run view.
    if (event.type === 'run_completed') {
      const assistantMessage: Message = {
        id: `assistant-${event.runId}`,
        role: 'assistant',
        content: event.payload.answer,
        timestamp: event.timestamp,
        toolCalls: event.payload.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          toolName: toolCall.toolName,
          args: toolCall.args,
          startedAt: toolCall.startedAt,
          completedAt: toolCall.completedAt,
          status: toolCall.status === 'error' ? 'error' : 'success',
          result: toolCall.result,
          error: toolCall.error,
        })),
      };
      set(messages, [...get(messages), assistantMessage]);
      set(sessionsAtom, (sessions) => sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'idle' as const, messageCount: session.messageCount + 1 } : session
      ));
      set(lastRunSummaryAtom, (previous) => ({
        runId: event.runId,
        sessionId,
        status: 'completed',
        startedAt: previous?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
        toolCount: event.payload.toolCalls.length,
        workspaceContext: previous?.workspaceContext,
      }));
      set(runViewAtom, null);
      return;
    }

    if (event.type === 'run_failed') {
      const cancelled = event.payload.error.code === 'RUN_CANCELLED';
      set(sessionsAtom, (sessions) => sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'idle' as const } : session
      ));

      // V8.1 §38–39: infrastructure failure (Pi process failed to start/stay
      // up) is not an answer — no assistant message, keep runView so the panel
      // renders a dedicated runtime banner with Retry + Diagnostics. Real
      // failures (tool errors, task failures) keep the existing message flow.
      const error = event.payload.error;
      if (isRuntimeInfraCode(error.code)) {
        set(lastRunSummaryAtom, (previous) => ({
          runId: event.runId,
          sessionId,
          status: 'failed',
          startedAt: previous?.startedAt ?? event.timestamp,
          completedAt: event.timestamp,
          toolCount: run.toolCalls.length,
          workspaceContext: previous?.workspaceContext,
          stopReason: undefined,
          stopDetail: undefined,
        }));
        set(runViewAtom, { ...run, infraError: error });
        return;
      }

      const guardStop = describeGuardStop(error);
      const guardStopInfo = getGuardStopInfo(error);
      const assistantMessage: Message = {
        id: `assistant-${event.runId}`,
        role: 'assistant',
        content: cancelled
          ? (run.answer || '(run stopped)')
          : guardStop === undefined
            ? `Error: ${error.message}`
            : [run.answer, guardStop].filter((part) => part !== '').join('\n\n'),
        timestamp: event.timestamp,
        toolCalls: run.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          toolName: toolCall.toolName,
          args: toolCall.args,
          startedAt: toolCall.startedAt,
          completedAt: toolCall.completedAt,
          status: toolCall.status === 'error' ? 'error' : 'success',
          result: toolCall.result,
          error: toolCall.error,
        })),
      };
      set(messages, [...get(messages), assistantMessage]);
      set(sessionsAtom, (sessions) => sessions.map((session) =>
        session.id === sessionId
          ? { ...session, status: 'idle' as const, messageCount: session.messageCount + 1 }
          : session
      ));
      set(lastRunSummaryAtom, (previous) => ({
        runId: event.runId,
        sessionId,
        status: cancelled ? 'cancelled' : 'failed',
        startedAt: previous?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
        toolCount: run.toolCalls.length,
        workspaceContext: previous?.workspaceContext,
        stopReason: guardStopInfo?.reason,
        stopDetail: guardStopInfo?.detail,
      }));
      set(runViewAtom, null);
      return;
    }
  }
);

export const cancelRunAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    const run = _get(runViewAtom);
    const sessionId = _get(activeSessionIdAtom);
    if (!run || !sessionId) return;
    await client.kernel.cancelRun(sessionId, run.runId);
  }
);

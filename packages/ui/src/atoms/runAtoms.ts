import { atom } from 'jotai';
import type { AgentEvent, ApiError, Message, ToolCall } from '@finagent/core';
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

export const runViewAtom = atom<RunView | null>(null);

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
        set(runViewAtom, { ...run, infraError: error });
        return;
      }

      const assistantMessage: Message = {
        id: `assistant-${event.runId}`,
        role: 'assistant',
        content: cancelled
          ? (run.answer || '(run stopped)')
          : `Error: ${error.message}`,
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

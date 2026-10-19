import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { AgentEvent } from '@finagent/core';
import {
  activeSessionIdAtom,
  messagesAtomFamily,
} from './sessionAtoms';
import { applyAgentEventAtom, lastRunSummaryAtom, runViewAtom } from './runAtoms';

function runStarted(sessionId: string): AgentEvent {
  return {
    id: `event-${sessionId}`,
    sessionId,
    runId: `run-${sessionId}`,
    timestamp: 1,
    sequence: 1,
    type: 'run_started',
    payload: {
      run: {
        id: `run-${sessionId}`,
        sessionId,
        status: 'running',
        input: 'internal prompt',
        startedAt: 1,
      },
      userMessage: {
        id: `message-${sessionId}`,
        role: 'user',
        content: 'internal prompt',
        timestamp: 1,
      },
    },
  };
}

describe('agent event projection', () => {
  it('keeps internal sessions out of the visible copilot', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');

    store.set(applyAgentEventAtom, runStarted('research-internal-session'));

    expect(store.get(runViewAtom)).toBeNull();
    expect(store.get(messagesAtomFamily('research-internal-session'))).toEqual([]);
  });

  it('projects events for the active session', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');

    store.set(applyAgentEventAtom, runStarted('visible-session'));

    expect(store.get(runViewAtom)?.sessionId).toBe('visible-session');
    expect(store.get(messagesAtomFamily('visible-session'))[0]?.content).toBe('internal prompt');
  });
});

function answered(sessionId: string, answer: string): AgentEvent {
  return {
    id: `event-answer-${sessionId}`,
    sessionId,
    runId: `run-${sessionId}`,
    timestamp: 2,
    sequence: 2,
    type: 'message_completed',
    payload: { answer },
  } as unknown as AgentEvent;
}

function runStopped(sessionId: string, code: string, message: string): AgentEvent {
  return {
    id: `event-failed-${sessionId}`,
    sessionId,
    runId: `run-${sessionId}`,
    timestamp: 9,
    sequence: 9,
    type: 'run_failed',
    payload: { error: { code, message } },
  } as unknown as AgentEvent;
}

/** The assistant message the projection appended for the finished run. */
function lastAssistantContent(store: ReturnType<typeof createStore>, sessionId: string): string {
  const messages = store.get(messagesAtomFamily(sessionId));
  return messages[messages.length - 1]?.content ?? '';
}

describe('guard stops read like a stop, not like an error (#17)', () => {
  it('shows why the run stopped next to the work it had already completed', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');
    store.set(applyAgentEventAtom, runStarted('visible-session'));
    store.set(applyAgentEventAtom, answered('visible-session', '复利是把收益继续投入本金。'));
    store.set(
      applyAgentEventAtom,
      runStopped(
        'visible-session',
        'BUDGET_EXHAUSTED',
        'Run stopped: budget_exhausted. {"key":"modelCalls","limit":1,"used":1}'
      )
    );

    const content = lastAssistantContent(store, 'visible-session');
    expect(content).toContain('复利是把收益继续投入本金。');
    expect(content).toContain('budget');
    expect(content).toContain('modelCalls 1/1');
    expect(content.startsWith('Error:')).toBe(false);
    expect(store.get(lastRunSummaryAtom)).toMatchObject({
      status: 'failed',
      stopReason: 'budget_exhausted',
      stopDetail: { key: 'modelCalls', limit: 1, used: 1 },
    });
  });

  it('names the loop for a loop-stopped run', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');
    store.set(applyAgentEventAtom, runStarted('visible-session'));
    store.set(
      applyAgentEventAtom,
      runStopped(
        'visible-session',
        'LOOP_DETECTED',
        'Run stopped: loop_detected. {"signal":"repeated_tool_call","tool":"bash","count":2}'
      )
    );

    const content = lastAssistantContent(store, 'visible-session');
    expect(content).toContain('loop');
    expect(content).toContain('bash');
    expect(content.startsWith('Error:')).toBe(false);
    expect(store.get(lastRunSummaryAtom)).toMatchObject({
      stopReason: 'loop_detected',
      stopDetail: { signal: 'repeated_tool_call', tool: 'bash', count: 2 },
    });
  });

  it('keeps the plain error for ordinary failures', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');
    store.set(applyAgentEventAtom, runStarted('visible-session'));
    store.set(applyAgentEventAtom, runStopped('visible-session', 'TOOL_ERROR', 'get_quote failed'));

    expect(lastAssistantContent(store, 'visible-session')).toBe('Error: get_quote failed');
    expect(store.get(lastRunSummaryAtom)).toMatchObject({ status: 'failed' });
    expect(store.get(lastRunSummaryAtom)?.stopReason).toBeUndefined();
  });

  it('keeps the retry-stop reason without exposing unapproved detail fields', () => {
    const store = createStore();
    store.set(activeSessionIdAtom, 'visible-session');
    store.set(applyAgentEventAtom, runStarted('visible-session'));
    store.set(
      applyAgentEventAtom,
      runStopped(
        'visible-session',
        'RETRY_STORM',
        'Run stopped: retry_storm. {"signal":"retry_storm","retriesInWindow":4,"windowMs":60000,"secret":"omit"}'
      )
    );

    expect(store.get(lastRunSummaryAtom)).toMatchObject({
      stopReason: 'retry_storm',
      stopDetail: { signal: 'retry_storm' },
    });
    expect(store.get(lastRunSummaryAtom)?.stopDetail).not.toHaveProperty('secret');
    expect(store.get(lastRunSummaryAtom)?.stopDetail).not.toHaveProperty('retriesInWindow');
  });
});

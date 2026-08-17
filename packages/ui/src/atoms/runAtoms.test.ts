import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { AgentEvent } from '@finagent/core';
import {
  activeSessionIdAtom,
  messagesAtomFamily,
} from './sessionAtoms';
import { applyAgentEventAtom, runViewAtom } from './runAtoms';

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

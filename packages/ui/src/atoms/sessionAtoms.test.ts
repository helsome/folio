import { beforeEach, describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { FinagentClient } from '../client';
import type { Run, SessionMeta } from '@finagent/core';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  createSessionAtom,
  hydrateSessionsAtom,
  loadMessagesAtom,
  messagesAtomFamily,
  sessionsAtom,
} from './sessionAtoms.ts';

let sessionCounter = 0;
let savedSessions: SessionMeta[] = [];
let savedMessages: Record<string, unknown[]> = {};

function makeSession(title: string): SessionMeta {
  sessionCounter += 1;
  return {
    id: `s${sessionCounter}`,
    title,
    status: 'idle',
    createdAt: 1000,
    updatedAt: 1000,
    messageCount: 0,
  };
}

function makeClient(): FinagentClient {
  return {
    kernel: {
      hydrate: async () => ({ ok: true as const, data: { sessions: savedSessions } }),
      createSession: async (title?: string) => {
        const session = makeSession(title ?? 'New Session');
        savedSessions = [...savedSessions, session];
        return { ok: true as const, data: session };
      },
      deleteSession: async (id: string) => {
        savedSessions = savedSessions.filter((session) => session.id !== id);
        return { ok: true as const, data: undefined };
      },
      getMessages: async (sessionId: string) => ({
        ok: true as const,
        data: (savedMessages[sessionId] ?? []) as never[],
      }),
      listRuns: async () => ({ ok: true as const, data: [] as Run[] }),
      startRun: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      cancelRun: async () => ({ ok: true as const, data: undefined }),
      onAgentEvent: () => () => undefined,
    },
    agent: {
      getTools: async () => ({ ok: true as const, data: [] }),
    },
    market: {
      getQuote: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getKline: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getPortfolio: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getStaticInfo: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getCalcIndex: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getMarketStatus: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getNews: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
    },
    longbridge: {
      getStatus: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
    },
    alerts: {
      loadRules: async () => ({ ok: true as const, data: [] }),
      saveRules: async () => ({ ok: true as const, data: undefined }),
      listEvents: async () => ({ ok: true as const, data: [] }),
      onTriggered: () => () => undefined,
    },
    llm: {
      getState: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      listModels: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      setModel: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      listThinkingLevels: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      setThinkingLevel: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      getProviders: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      listCredentials: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      setCredential: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      removeCredential: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      setCustomProvider: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      removeCustomProvider: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      testProvider: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
    },
    skills: {
      list: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      setEnabled: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      listResources: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      readResource: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      readiness: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
    },
  };
}

describe('session atoms', () => {
  beforeEach(() => {
    sessionCounter = 0;
    savedSessions = [];
    savedMessages = {};
  });

  it('hydrates sessions from the kernel and activates the first one', async () => {
    const store = createStore();
    savedSessions = [makeSession('Session A')];

    await store.set(hydrateSessionsAtom, makeClient());

    expect(store.get(sessionsAtom)).toHaveLength(1);
    expect(store.get(activeSessionIdAtom)).toBe('s1');
    expect(store.get(sessionsAtom)[0]).toMatchObject({ title: 'Session A', messageCount: 0 });
  });

  it('creates a session through the kernel and activates it', async () => {
    const store = createStore();
    const client = makeClient();

    await store.set(createSessionAtom, client, 'Portfolio Review');

    expect(store.get(sessionsAtom)).toHaveLength(1);
    expect(store.get(activeSessionIdAtom)).toBe('s1');
    expect(store.get(sessionsAtom)[0].title).toBe('Portfolio Review');
  });

  it('loads messages for the active session lazily from the kernel', async () => {
    const store = createStore();
    savedSessions = [makeSession('Session A')];
    savedMessages = {
      s1: [{ id: 'm1', role: 'user', content: 'AAPL.US quote', timestamp: 1000 }],
    };
    const client = makeClient();

    await store.set(hydrateSessionsAtom, client);
    await store.set(loadMessagesAtom, client, 's1');

    expect(store.get(activeMessagesAtom)).toHaveLength(1);
    expect(store.get(activeMessagesAtom)[0]).toMatchObject({
      id: 'm1',
      content: 'AAPL.US quote',
    });
  });

  it('keeps per-session message caches isolated', async () => {
    const store = createStore();
    savedSessions = [makeSession('A'), makeSession('B')];
    savedMessages = {
      s1: [{ id: 'm1', role: 'user', content: 'from A', timestamp: 1000 }],
      s2: [{ id: 'm2', role: 'user', content: 'from B', timestamp: 1000 }],
    };
    const client = makeClient();

    await store.set(hydrateSessionsAtom, client);
    await store.set(loadMessagesAtom, client, 's1');
    await store.set(loadMessagesAtom, client, 's2');

    expect(store.get(messagesAtomFamily('s1'))[0].content).toBe('from A');
    expect(store.get(messagesAtomFamily('s2'))[0].content).toBe('from B');
  });
});

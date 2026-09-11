import { beforeEach, describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { FinagentClient } from '../client';
import type { ConversationBranch, Run, SessionMeta } from '@finagent/core';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  branchesAtomFamily,
  createSessionAtom,
  hydrateSessionsAtom,
  loadBranchesAtom,
  loadMessagesAtom,
  messagesAtomFamily,
  sessionsAtom,
  switchBranchAtom,
} from './sessionAtoms.ts';

let sessionCounter = 0;
let savedSessions: SessionMeta[] = [];
let savedMessages: Record<string, unknown[]> = {};
let savedBranches: Record<string, ConversationBranch[]> = {};
let savedBranchMessages: Record<string, unknown[]> = {};

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
      listBranches: async (sessionId: string) => ({ ok: true as const, data: savedBranches[sessionId] ?? [] }),
      setActiveBranch: async (sessionId: string, branchId: string) => {
        const branch = (savedBranches[sessionId] ?? []).find((candidate) => candidate.id === branchId);
        if (!branch) return { ok: false as const, error: { code: 'TEST', message: 'branch not found' } };
        savedSessions = savedSessions.map((session) =>
          session.id === sessionId ? { ...session, activeBranchId: branchId } : session
        );
        savedMessages[sessionId] = savedBranchMessages[branchId] ?? [];
        return { ok: true as const, data: branch };
      },
      listRuns: async () => ({ ok: true as const, data: [] as Run[] }),
      startRun: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      retryRun: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      editMessage: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      regenerateMessage: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
      forkBranch: async () => ({ ok: false as const, error: { code: 'TEST', message: 'no-op' } }),
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
    savedBranches = {};
    savedBranchMessages = {};
  });

  it('hydrates sessions from the kernel and activates the first one', async () => {
    const store = createStore();
    savedSessions = [makeSession('Session A')];

    await store.set(hydrateSessionsAtom, makeClient());

    expect(store.get(sessionsAtom)).toHaveLength(1);
    expect(store.get(activeSessionIdAtom)).toBe('s1');
    expect(store.get(sessionsAtom)[0]).toMatchObject({ title: 'Session A', messageCount: 0 });
  });

  it('hides internal research sessions while preserving user sessions', async () => {
    const store = createStore();
    savedSessions = [makeSession('Research'), makeSession('__folio_internal_research__'), makeSession('Session A')];

    await store.set(hydrateSessionsAtom, makeClient());

    expect(store.get(sessionsAtom)).toHaveLength(1);
    expect(store.get(sessionsAtom)[0].title).toBe('Session A');
    expect(store.get(activeSessionIdAtom)).toBe('s3');
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

  it('loads and switches branches without mixing the visible transcript', async () => {
    const store = createStore();
    savedSessions = [makeSession('Branching')];
    savedBranches.s1 = [
      { id: 'main', sessionId: 's1', name: 'Main', createdAt: 1, updatedAt: 1 },
      { id: 'alt', sessionId: 's1', name: 'Alternative', createdAt: 2, updatedAt: 2, parentBranchId: 'main', forkMessageId: null },
    ];
    savedBranchMessages.main = [{ id: 'main-user', role: 'user', content: 'main question', timestamp: 1 }];
    savedBranchMessages.alt = [{ id: 'alt-user', role: 'user', content: 'alternative question', timestamp: 2 }];
    savedMessages.s1 = savedBranchMessages.main;
    const client = makeClient();

    await store.set(hydrateSessionsAtom, client);
    await store.set(loadBranchesAtom, client, 's1');
    await store.set(loadMessagesAtom, client, 's1');
    await store.set(switchBranchAtom, client, 's1', 'alt');

    expect(store.get(branchesAtomFamily('s1'))).toHaveLength(2);
    expect(store.get(sessionsAtom)[0].activeBranchId).toBe('alt');
    expect(store.get(activeMessagesAtom).map((message) => message.content)).toEqual(['alternative question']);
  });
});

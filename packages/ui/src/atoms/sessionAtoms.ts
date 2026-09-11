import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { ApiResult, ConversationBranch, Message, Run, SessionMeta } from '@finagent/core';
import type { FinagentClient } from '../client';

// The kernel (main process) is the source of truth for sessions and messages;
// these atoms are the renderer's view cache, hydrated from and updated by it.

export const sessionsAtom = atom<SessionMeta[]>([]);

export const activeSessionIdAtom = atom<string | null>(null);

export const activeSessionAtom = atom((get) => {
  const activeId = get(activeSessionIdAtom);
  if (!activeId) return null;
  return get(sessionsAtom).find((session) => session.id === activeId) ?? null;
});

// Per-session message cache, loaded lazily from the kernel.
export const messagesAtomFamily = atomFamily((_sessionId: string) => atom<Message[]>([]));

// Branch metadata is cached per session so switching sessions does not lose
// the last selected branch or make the renderer reconstruct lineage locally.
export const branchesAtomFamily = atomFamily((_sessionId: string) => atom<ConversationBranch[]>([]));
export const runsAtomFamily = atomFamily((_sessionId: string) => atom<Run[]>([]));

export const activeBranchesAtom = atom((get) => {
  const activeId = get(activeSessionIdAtom);
  return activeId ? get(branchesAtomFamily(activeId)) : [];
});

export const activeRunsAtom = atom((get) => {
  const activeId = get(activeSessionIdAtom);
  return activeId ? get(runsAtomFamily(activeId)) : [];
});

export const activeBranchAtom = atom((get) => {
  const session = get(activeSessionAtom);
  const branches = get(activeBranchesAtom);
  if (!session) return null;
  return branches.find((branch) => branch.id === session.activeBranchId)
    ?? branches.find((branch) => !branch.parentBranchId)
    ?? null;
});

export const activeMessagesAtom = atom((get) => {
  const activeId = get(activeSessionIdAtom);
  if (!activeId) return [];
  return get(messagesAtomFamily(activeId));
});

export const loadedSessionIdsAtom = atom<Set<string>>(new Set<string>());

/** Internal synthesis sessions are implementation details, not user chats. */
function isInternalSession(title: string): boolean {
  return title === 'Research' || title.startsWith('__folio_internal_');
}

export const hydrateSessionsAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    const result = await client.kernel.hydrate();
    if (!result.ok) return;
    const visibleSessions = result.data.sessions.filter((session) => !isInternalSession(session.title));
    set(sessionsAtom, visibleSessions);
    if (!_get(activeSessionIdAtom) && visibleSessions.length > 0) {
      set(activeSessionIdAtom, visibleSessions[0].id);
    }
  }
);

export const loadMessagesAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string) => {
    const result = await client.kernel.getMessages(sessionId);
    if (!result.ok) return;
    set(messagesAtomFamily(sessionId), result.data);
    set(loadedSessionIdsAtom, (loaded) => {
      const next = new Set(loaded);
      next.add(sessionId);
      return next;
    });
  }
);

export const loadBranchesAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string) => {
    const result = await client.kernel.listBranches(sessionId);
    if (!result.ok) return result;
    set(branchesAtomFamily(sessionId), result.data);
    const active = result.data.find((branch) => branch.id === _get(activeSessionAtom)?.activeBranchId)
      ?? result.data.find((branch) => !branch.parentBranchId);
    if (active) {
      set(sessionsAtom, (sessions) => sessions.map((session) =>
        session.id === sessionId && session.activeBranchId !== active.id
          ? { ...session, activeBranchId: active.id }
          : session
      ));
    }
    return result;
  }
);

export const loadRunsAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string) => {
    const result = await client.kernel.listRuns(sessionId);
    if (result.ok) set(runsAtomFamily(sessionId), result.data);
    return result;
  }
);

/** Refresh the local projection after an operation has already activated a branch in the kernel. */
export const refreshBranchProjectionAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string, branchId: string): Promise<ApiResult<ConversationBranch>> => {
    const branches = await client.kernel.listBranches(sessionId);
    if (!branches.ok) return branches;
    const branch = branches.data.find((candidate) => candidate.id === branchId);
    if (!branch) return { ok: false, error: { code: 'BRANCH_NOT_FOUND', message: `Branch ${branchId} was not found.` } };

    set(branchesAtomFamily(sessionId), branches.data);
    set(sessionsAtom, (sessions) => sessions.map((session) =>
      session.id === sessionId ? { ...session, activeBranchId: branchId } : session
    ));
    const messages = await client.kernel.getMessages(sessionId);
    if (messages.ok) {
      set(messagesAtomFamily(sessionId), messages.data);
      set(loadedSessionIdsAtom, (loaded) => {
        const next = new Set(loaded);
        next.add(sessionId);
        return next;
      });
    }
    return { ok: true, data: branch };
  }
);

/** Switch the persisted branch and immediately reload its visible projection. */
export const switchBranchAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string, branchId: string): Promise<ApiResult<ConversationBranch>> => {
    const result = await client.kernel.setActiveBranch(sessionId, branchId);
    if (!result.ok) return result;
    return set(refreshBranchProjectionAtom, client, sessionId, result.data.id);
  }
);

export const createSessionAtom = atom(
  null,
  async (_get, set, client: FinagentClient, title?: string) => {
    const result = await client.kernel.createSession(title);
    if (!result.ok) return null;
    set(sessionsAtom, (sessions) => [...sessions, result.data]);
    set(activeSessionIdAtom, result.data.id);
    set(messagesAtomFamily(result.data.id), []);
    return result.data;
  }
);

export const deleteSessionAtom = atom(
  null,
  async (_get, set, client: FinagentClient, sessionId: string) => {
    const result = await client.kernel.deleteSession(sessionId);
    if (!result.ok) return;
    set(sessionsAtom, (sessions) => sessions.filter((session) => session.id !== sessionId));
    messagesAtomFamily.remove(sessionId);
    if (_get(activeSessionIdAtom) === sessionId) {
      const remaining = _get(sessionsAtom);
      set(activeSessionIdAtom, remaining.length > 0 ? remaining[0].id : null);
    }
  }
);

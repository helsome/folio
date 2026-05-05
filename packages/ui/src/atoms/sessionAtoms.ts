import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Session, Message } from '@finagent/core';

// Session atom family for session isolation
export const sessionAtomFamily = atomFamily((sessionId: string) =>
  atom<Session>({
    id: sessionId,
    title: 'New Session',
    messages: [],
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
);

// Active session management
export const activeSessionIdAtom = atom<string | null>(null);

// All sessions list
export const sessionsAtom = atom<Session[]>([]);

// Derived atom for active session
export const activeSessionAtom = atom((get) => {
  const activeId = get(activeSessionIdAtom);
  if (!activeId) return null;
  return get(sessionAtomFamily(activeId));
});

// Messages derived from active session
export const activeMessagesAtom = atom((get) => {
  const session = get(activeSessionAtom);
  return session?.messages ?? [];
});

// Add message to session
export const addMessageAtom = atom(
  null,
  (get, set, message: Message) => {
    const sessionId = get(activeSessionIdAtom);
    if (!sessionId) return;

    const session = get(sessionAtomFamily(sessionId));
    const updatedSession: Session = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
    };
    set(sessionAtomFamily(sessionId), updatedSession);
  }
);

// Update session status
export const updateSessionStatusAtom = atom(
  null,
  (get, set, status: Session['status']) => {
    const sessionId = get(activeSessionIdAtom);
    if (!sessionId) return;

    const session = get(sessionAtomFamily(sessionId));
    set(sessionAtomFamily(sessionId), {
      ...session,
      status,
      updatedAt: Date.now(),
    });
  }
);

// Create new session
export const createSessionAtom = atom(
  null,
  (_get, set, title?: string) => {
    const newSession: Session = {
      id: crypto.randomUUID(),
      title: title ?? 'New Session',
      messages: [],
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(sessionsAtom, (sessions) => [...sessions, newSession]);
    set(activeSessionIdAtom, newSession.id);
    return newSession;
  }
);
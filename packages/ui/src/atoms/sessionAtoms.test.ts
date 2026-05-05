import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  addMessageAtom,
  createSessionAtom,
  sessionAtomFamily,
  sessionsAtom,
} from './sessionAtoms.ts';

describe('session atoms', () => {
  it('creates a session in both active session state and session list state', () => {
    const store = createStore();

    const session = store.set(createSessionAtom);

    expect(store.get(activeSessionIdAtom)).toBe(session.id);
    expect(store.get(sessionAtomFamily(session.id))).toMatchObject({
      id: session.id,
      messages: [],
    });
    expect(store.get(sessionsAtom)).toHaveLength(1);
  });

  it('keeps sidebar session metadata in sync when messages are added', () => {
    const store = createStore();
    const session = store.set(createSessionAtom);

    store.set(addMessageAtom, {
      id: 'm1',
      role: 'user',
      content: 'AAPL.US quote',
      timestamp: 1710000000,
    });

    expect(store.get(activeMessagesAtom)).toHaveLength(1);
    expect(store.get(sessionsAtom)[0]).toMatchObject({
      id: session.id,
      messages: [expect.objectContaining({ id: 'm1' })],
    });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { installHappyDom } from '../test/setupHappyDom';
import { persistedAtom, readPersisted, writePersisted } from './persistedPrefs';

let restore: (() => void) | undefined;

beforeAll(() => {
  const env = installHappyDom();
  restore = env.restore;
});

afterAll(() => {
  restore?.();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('persistedPrefs (V9 remember-the-user)', () => {
  it('restores the persisted value at atom init', () => {
    writePersisted('navSection', 'research');
    const atom = persistedAtom<string>('navSection', 'sessions');
    const store = createStore();
    expect(store.get(atom)).toBe('research');
  });

  it('falls back to the initial value when nothing is stored', () => {
    const atom = persistedAtom<boolean>('agentPanelVisible', true);
    const store = createStore();
    expect(store.get(atom)).toBe(true);
  });

  it('writes through on set and is read back on a fresh atom', () => {
    const atom = persistedAtom<string>('navSection', 'sessions');
    const store = createStore();
    store.set(atom, 'thesis');
    expect(readPersisted<string>('navSection', 'sessions')).toBe('thesis');
    expect(createStore().get(persistedAtom<string>('navSection', 'sessions'))).toBe('thesis');
  });

  it('handles invalid stored JSON without throwing', () => {
    window.localStorage.setItem('folio.prefs.navSection', '{not json');
    const atom = persistedAtom<string>('navSection', 'today');
    expect(() => createStore().get(atom)).not.toThrow();
    expect(createStore().get(atom)).toBe('today');
  });
});

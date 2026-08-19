/**
 * Lightweight persisted atom helper (V9 §19, §59, §123 — "the desktop app
 * should remember the user"). Only genuine user preferences / work context
 * are persisted — never transient loading/error state (§85). Persistence is
 * best-effort localStorage (same pattern as the onboarding flags) and safe in
 * sandboxed or test environments.
 */

import { atom, type PrimitiveAtom, type SetStateAction } from 'jotai';

const PREFS_PREFIX = 'folio.prefs.';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readValue<T>(storageKey: string, fallback: T): T {
  const storage = safeLocalStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeValue<T>(storageKey: string, value: T): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Non-critical: preference persistence must never break the UI.
  }
}

/** Read a persisted value directly (for components that need raw access). */
export function readPersisted<T>(key: string, fallback: T): T {
  return readValue(`${PREFS_PREFIX}${key}`, fallback);
}

/** Write a persisted value directly. */
export function writePersisted<T>(key: string, value: T): void {
  writeValue(`${PREFS_PREFIX}${key}`, value);
}

/**
 * A jotai atom whose value survives restarts. Reads synchronously at module
 * init (localStorage is available in the renderer before first paint), writes
 * on every set. Use only for real preferences/context, never transient state.
 */
export function persistedAtom<T>(key: string, initial: T): PrimitiveAtom<T> {
  const storageKey = `${PREFS_PREFIX}${key}`;
  const base = atom<T>(readValue(storageKey, initial));
  return atom(
    (get) => get(base),
    (_get, set, next: SetStateAction<T>) => {
      const resolved =
        typeof next === 'function'
          ? (next as (previous: T) => T)(_get(base))
          : next;
      set(base, resolved);
      writeValue(storageKey, resolved);
    }
  );
}

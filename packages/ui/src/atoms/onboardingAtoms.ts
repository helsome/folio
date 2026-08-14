import { atom } from 'jotai';

/**
 * First-run onboarding persistence (spec §27–30, §42).
 *
 * Two IPC-free localStorage flags under clear keys:
 *   - completed: the wizard has been finished or skipped (never re-shown)
 *   - disclaimers accepted: privacy + AI-analysis + financial-information
 *     one-time acceptance (re-viewable later via Settings/About)
 *
 * Persistence is best-effort and safe in sandboxed/privacy contexts and in the
 * test environment (where `localStorage` is installed after module import).
 */

export const ONBOARDING_STORAGE_KEY = 'folio.onboarding.completed.v1';
export const DISCLAIMER_STORAGE_KEY = 'folio.onboarding.disclaimersAccepted.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readStorageFlag(key: string, storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeStorageFlag(key: string, value: boolean, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch {
    // best-effort persistence — never throw on storage failures
  }
}

export const onboardingCompletedAtom = atom<boolean>(
  readStorageFlag(ONBOARDING_STORAGE_KEY, safeLocalStorage())
);

export const disclaimersAcceptedAtom = atom<boolean>(
  readStorageFlag(DISCLAIMER_STORAGE_KEY, safeLocalStorage())
);

/** Mark the wizard complete/skipped and persist it. */
export const completeOnboardingAtom = atom(null, (_get, set) => {
  set(onboardingCompletedAtom, true);
  writeStorageFlag(ONBOARDING_STORAGE_KEY, true, safeLocalStorage());
});

/** Record the one-time disclaimer acceptance and persist it. */
export const acceptDisclaimersAtom = atom(null, (_get, set) => {
  set(disclaimersAcceptedAtom, true);
  writeStorageFlag(DISCLAIMER_STORAGE_KEY, true, safeLocalStorage());
});

import { describe, expect, it } from 'bun:test';
import type { StorageLike } from './onboardingAtoms';
import {
  DISCLAIMER_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  readStorageFlag,
  writeStorageFlag,
} from './onboardingAtoms';

function memoryStorage(): { storage: StorageLike; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
}

describe('onboarding persistence flags', () => {
  it('reads false from absent storage', () => {
    expect(readStorageFlag(ONBOARDING_STORAGE_KEY, null)).toBe(false);
  });

  it('round-trips each flag through storage', () => {
    const { storage } = memoryStorage();

    expect(readStorageFlag(DISCLAIMER_STORAGE_KEY, storage)).toBe(false);
    writeStorageFlag(DISCLAIMER_STORAGE_KEY, true, storage);
    expect(readStorageFlag(DISCLAIMER_STORAGE_KEY, storage)).toBe(true);

    expect(readStorageFlag(ONBOARDING_STORAGE_KEY, storage)).toBe(false);
    writeStorageFlag(ONBOARDING_STORAGE_KEY, true, storage);
    expect(readStorageFlag(ONBOARDING_STORAGE_KEY, storage)).toBe(true);

    writeStorageFlag(DISCLAIMER_STORAGE_KEY, false, storage);
    expect(readStorageFlag(DISCLAIMER_STORAGE_KEY, storage)).toBe(false);
  });

  it('never throws when storage access raises', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readStorageFlag(ONBOARDING_STORAGE_KEY, throwing)).toBe(false);
    expect(() => writeStorageFlag(ONBOARDING_STORAGE_KEY, true, throwing)).not.toThrow();
  });
});

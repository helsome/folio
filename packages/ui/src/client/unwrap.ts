import type { ApiResult } from '@finagent/core';

/**
 * Unwrap a main-process IPC result envelope for the defensive V3 loaders.
 * Returns the payload for `{ ok: true, data }`, null for failures or
 * non-envelope values (so a missing channel degrades gracefully).
 */
export function unwrapIpcResult<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object' || !('ok' in value)) return null;
  const result = value as ApiResult<T>;
  if (!result.ok) return null;
  return result.data;
}

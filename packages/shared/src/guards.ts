/**
 * Canonical runtime guards for reading `unknown` capability data. This is the
 * single source for these helpers (the repo's type-guard convention: define the
 * guard once and import it, never recreate it at call sites).
 */

/** Narrow `unknown` to a plain object. Proves only object-ness, not fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce a number or a numeric string (the Longbridge CLI emits many values as
 * strings) into a finite number, else `undefined`. Used wherever a missing or
 * malformed value must degrade to a missing cell/note rather than a crash.
 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

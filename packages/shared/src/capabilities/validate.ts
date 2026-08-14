import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';

/** A code-carrying error, consumed by `toApiError` in the agent layer. */
export function createCapabilityError(code: string, message: string, action?: string) {
  const error = new Error(message) as Error & { code: string; action?: string };
  error.code = code;
  error.action = action;
  return error;
}

/**
 * Validate `input` against a TypeBox schema using `Value.Check`. On mismatch
 * throws a `CAPABILITY_INPUT_INVALID` code error whose message names the first
 * error path (e.g. `/symbol`), never a raw TypeBox assertion.
 */
export function validateInput<T>(schema: TSchema, input: unknown): T {
  if (Value.Check(schema, input)) {
    return input as T;
  }
  const firstError = [...Value.Errors(schema, input)][0];
  const path = firstError?.path ? firstError.path : '/';
  const detail = firstError?.message ?? 'value does not match the expected shape';
  throw createCapabilityError(
    'CAPABILITY_INPUT_INVALID',
    `Invalid capability input at ${path}: ${detail}`
  );
}

/** Trim and uppercase a symbol before handing it to the Longbridge fetcher. */
export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

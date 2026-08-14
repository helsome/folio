import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';

export function validateParams<T>(schema: TSchema, params: unknown): T {
  if (!Value.Check(schema, params)) {
    const firstError = [...Value.Errors(schema, params)][0];
    throw new Error(firstError?.message ?? 'Invalid tool arguments.');
  }
  return params as T;
}

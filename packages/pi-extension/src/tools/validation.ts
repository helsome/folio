import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';

const SYMBOL_PATTERN = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

export function validateParams<T>(schema: TSchema, params: unknown): T {
  if (!Value.Check(schema, params)) {
    const firstError = [...Value.Errors(schema, params)][0];
    throw new Error(firstError?.message ?? 'Invalid tool arguments.');
  }
  return params as T;
}

export function normalizeSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new Error(`Invalid symbol format: ${symbol}. Expected AAPL.US, 0700.HK, or 600519.SH.`);
  }
  return normalized;
}

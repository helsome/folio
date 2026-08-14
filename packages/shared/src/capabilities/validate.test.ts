import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { normalizeSymbol, validateInput } from './validate.ts';

describe('validateInput', () => {
  it('returns the validated input when it matches', () => {
    const schema = Type.Object({ symbol: Type.String() });
    expect(validateInput<{ symbol: string }>(schema, { symbol: 'AAPL.US' })).toEqual({ symbol: 'AAPL.US' });
  });

  it('throws CAPABILITY_INPUT_INVALID naming the first error path', () => {
    const schema = Type.Object({ symbol: Type.String(), limit: Type.Number() });
    const error = catchError(() => validateInput(schema, { symbol: 123, limit: 5 }));
    expect(error.code).toBe('CAPABILITY_INPUT_INVALID');
    expect(error.message).toContain('/symbol');
  });
});

describe('normalizeSymbol', () => {
  it('trims and uppercases the symbol', () => {
    expect(normalizeSymbol(' aapl.us ')).toBe('AAPL.US');
  });
});

function catchError(fn: () => void): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error('expected the function to throw');
}

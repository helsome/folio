import { describe, expect, it } from 'bun:test';
import {
  resolveCanonicalInstrument,
  resolveCanonicalInstrumentId,
} from './instruments.ts';

describe('resolveCanonicalInstrument', () => {
  it('resolves bare Yahoo symbol to canonical instrument using providerId', () => {
    const instrument = resolveCanonicalInstrument('AAPL', 'yahoo');
    expect(instrument?.instrumentId).toBe('XNAS:AAPL');
    expect(instrument?.symbol).toBe('AAPL');
    expect(instrument?.currency).toBe('USD');
  });

  it('falls back to universal resolution when symbol has standard market suffix', () => {
    // Yahoo expects bare 'AAPL', but user queried 'AAPL.US' with Yahoo as provider
    const instrument = resolveCanonicalInstrument('AAPL.US', 'yahoo');
    expect(instrument?.instrumentId).toBe('XNAS:AAPL');
    expect(resolveCanonicalInstrumentId('AAPL.US', 'yahoo')).toBe('XNAS:AAPL');
  });

  it('resolves Longbridge symbol accurately', () => {
    const instrument = resolveCanonicalInstrument('AAPL.US', 'longbridge');
    expect(instrument?.instrumentId).toBe('XNAS:AAPL');
    expect(resolveCanonicalInstrumentId('AAPL.US', 'longbridge')).toBe('XNAS:AAPL');
  });

  it('resolves canonical ID directly regardless of provider', () => {
    expect(resolveCanonicalInstrumentId('XNAS:AAPL', 'yahoo')).toBe('XNAS:AAPL');
    expect(resolveCanonicalInstrumentId('XNAS:AAPL', 'longbridge')).toBe('XNAS:AAPL');
    expect(resolveCanonicalInstrumentId('XNAS:AAPL')).toBe('XNAS:AAPL');
  });

  it('returns undefined for non-existent symbol', () => {
    expect(resolveCanonicalInstrument('NONEXISTENT_TICKER', 'yahoo')).toBeUndefined();
    expect(resolveCanonicalInstrumentId('NONEXISTENT_TICKER')).toBeUndefined();
  });
});

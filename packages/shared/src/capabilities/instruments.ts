import {
  DEFAULT_INSTRUMENT_CATALOG,
  InstrumentResolver,
  type CanonicalInstrument,
} from '@finagent/core';

export const DEFAULT_INSTRUMENT_RESOLVER = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG);

/**
 * Resolve a symbol to its canonical instrument.
 * Prioritizes matching by the answering provider's alias (e.g. Yahoo's 'AAPL' vs Longbridge's 'AAPL.US'),
 * falling back to universal alias/ticker/ID resolution so cross-provider inputs remain supported.
 */
export function resolveCanonicalInstrument(
  symbol: string,
  providerId?: string
): CanonicalInstrument | undefined {
  if (providerId) {
    const resolution = DEFAULT_INSTRUMENT_RESOLVER.resolve(symbol, { providerId });
    if (resolution.status === 'resolved') {
      return resolution.instrument;
    }
  }
  const fallbackResolution = DEFAULT_INSTRUMENT_RESOLVER.resolve(symbol);
  return fallbackResolution.status === 'resolved' ? fallbackResolution.instrument : undefined;
}

export function resolveCanonicalInstrumentId(
  symbol: string,
  providerId?: string
): string | undefined {
  return resolveCanonicalInstrument(symbol, providerId)?.instrumentId;
}

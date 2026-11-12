import { createHash } from 'node:crypto';
import type { InstrumentResolver, WatchlistContextSnapshot } from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';

export function captureWatchlistContext(
  input: unknown,
  resolver: InstrumentResolver,
  capturedAt: number
): WatchlistContextSnapshot {
  if (
    !Array.isArray(input) || input.length === 0 || input.length > 100 ||
    input.some((symbol) => typeof symbol !== 'string' || !symbol.trim() || symbol.length > 128)
  ) {
    throw createCodeError('INVALID_ARGUMENT', 'Select between 1 and 100 valid watchlist symbols.');
  }
  const instruments: WatchlistContextSnapshot['instruments'] = [];
  for (const symbol of input as string[]) {
    const resolved = resolver.resolve(symbol);
    if (resolved.status !== 'resolved') {
      throw createCodeError('INVALID_ARGUMENT', 'Every watchlist symbol must resolve to one canonical instrument.');
    }
    const { instrumentId, symbol: canonicalSymbol, providerAliases } = resolved.instrument;
    if (!instruments.some((instrument) => instrument.instrumentId === instrumentId)) {
      instruments.push({
        instrumentId,
        symbol: canonicalSymbol,
        providerAliases: providerAliases.map((alias) => ({ ...alias })),
      });
    }
  }
  const identity = instruments.map((instrument) => instrument.instrumentId).sort();
  return {
    schemaVersion: 1,
    sourceId: 'default',
    version: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    capturedAt,
    instruments,
  };
}

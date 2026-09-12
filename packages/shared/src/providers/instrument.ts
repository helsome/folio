import {
  DEFAULT_INSTRUMENT_CATALOG,
  getProviderSymbol,
  InstrumentResolver,
  isCanonicalInstrument,
  type CanonicalInstrument,
  type InstrumentCatalogSnapshot,
  type InstrumentResolution,
  type InstrumentResolutionOptions,
  type ProviderError,
  type ProviderResult,
} from '@finagent/core';
import { isRecord } from '../guards.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';

export const INSTRUMENT_CATALOG_FILE = 'instruments.json';

export type BoundProviderInput =
  | {
      ok: true;
      symbol: string;
      instrument?: CanonicalInstrument;
      instrumentId?: string;
      input: Record<string, unknown>;
    }
  | { ok: false; error: ProviderError };

/**
 * Adapter-side bind: a canonical instrument is converted to that provider's
 * symbol. Bare ticker strings stay as-is so unknown listings still work.
 */
export function bindProviderInput(input: unknown, providerId: string): BoundProviderInput {
  const record = isRecord(input) ? { ...input } : {};
  const instrument = isCanonicalInstrument(record.instrument) ? record.instrument : undefined;

  if (instrument) {
    const symbol = getProviderSymbol(instrument, providerId);
    if (!symbol) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_CAPABILITY',
          message: `No ${providerId} symbol is mapped for ${instrument.instrumentId}.`,
        },
      };
    }
    record.symbol = symbol;
    return {
      ok: true,
      symbol,
      instrument,
      instrumentId: instrument.instrumentId,
      input: record,
    };
  }

  const symbol = typeof record.symbol === 'string' ? record.symbol.trim() : '';
  const instrumentId =
    typeof record.instrumentId === 'string' && record.instrumentId.trim() !== ''
      ? record.instrumentId.trim()
      : undefined;
  return { ok: true, symbol, instrumentId, input: record };
}

export function stampInstrumentId<T>(data: T, instrumentId?: string): T {
  if (!instrumentId) return data;
  if (Array.isArray(data)) {
    return data.map((item) => stampInstrumentId(item, instrumentId)) as T;
  }
  if (typeof data === 'object' && data !== null) {
    return { ...data, instrumentId };
  }
  return data;
}

export function stampProviderResult<T>(
  result: ProviderResult<T>,
  instrumentId?: string
): ProviderResult<T> {
  if (!instrumentId || !result.ok) return result;
  return {
    ok: true,
    data: stampInstrumentId(result.data, instrumentId),
    provenance: { ...result.provenance, instrumentId },
  };
}

export function attachResolvedInstrument(
  input: Record<string, unknown>,
  resolution: InstrumentResolution
): Record<string, unknown> {
  if (resolution.status !== 'resolved') return input;
  return {
    ...input,
    instrument: resolution.instrument,
    instrumentId: resolution.instrument.instrumentId,
  };
}

/** Persist and reload the versioned provider-alias catalog. */
export class InstrumentCatalogStore {
  constructor(
    private readonly store: JsonFileStore,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<InstrumentResolver> {
    const snapshot = await this.store.read<InstrumentCatalogSnapshot | null>(
      INSTRUMENT_CATALOG_FILE,
      null
    );
    if (!snapshot) {
      const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG);
      await this.save(resolver);
      return resolver;
    }
    return InstrumentResolver.fromSnapshot(snapshot);
  }

  async save(resolver: InstrumentResolver): Promise<void> {
    await this.store.write(INSTRUMENT_CATALOG_FILE, resolver.snapshot(this.now()));
  }
}

export type InstrumentQueryResolver = (
  query: string,
  options?: InstrumentResolutionOptions
) => InstrumentResolution;

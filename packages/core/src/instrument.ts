/**
 * Canonical instrument identity and deterministic symbol resolution.
 *
 * Provider symbols are aliases of a Folio-owned identity. They must not be
 * used as the identity itself because providers disagree on symbol formats.
 */

export const INSTRUMENT_CATALOG_SCHEMA_VERSION = 1 as const;

export const INSTRUMENT_ASSET_TYPES = [
  'equity',
  'etf',
  'fund',
  'index',
  'future',
  'option',
  'forex',
  'crypto',
  'other',
] as const;

export type InstrumentAssetType = (typeof INSTRUMENT_ASSET_TYPES)[number];

const INSTRUMENT_ASSET_TYPE_SET: ReadonlySet<string> = new Set(INSTRUMENT_ASSET_TYPES);

export type InstrumentExternalIdType = 'isin' | 'cusip' | 'sedol';

export interface InstrumentExternalId {
  type: InstrumentExternalIdType;
  value: string;
}

export interface InstrumentProviderAlias {
  /** Stable Folio provider id, for example `longbridge` or `massive`. */
  providerId: string;
  /** Exact symbol expected by that provider. */
  symbol: string;
}

export interface CanonicalInstrument {
  /** Folio-owned stable id. Provider symbols must never be stored here. */
  instrumentId: string;
  /** Canonical exchange-local symbol, without a provider-specific suffix. */
  symbol: string;
  name: string;
  /** Alternative company/security names accepted by the resolver. */
  nameAliases?: string[];
  /** ISO 10383 MIC when known. */
  exchangeMic?: string;
  /** Human-readable exchange code when useful to display. */
  exchange?: string;
  /** Product market code, for example `US`, `HK`, or `SG`. */
  market: string;
  /** ISO 3166-1 alpha-2 country/territory code for the listing venue. */
  country: string;
  assetType: InstrumentAssetType;
  /** Native trading currency, as an ISO 4217 code. */
  currency: string;
  providerAliases: InstrumentProviderAlias[];
  externalIds?: InstrumentExternalId[];
}

export interface InstrumentCatalogSnapshot {
  schemaVersion: typeof INSTRUMENT_CATALOG_SCHEMA_VERSION;
  /** Epoch milliseconds when this catalog was produced. */
  updatedAt: number;
  instruments: CanonicalInstrument[];
}

export interface InstrumentResolutionOptions {
  /** Restrict otherwise ambiguous symbols or names to one product market. */
  market?: string;
  /** Treat the query as a symbol in this provider's namespace. */
  providerId?: string;
}

export type InstrumentMatchKind = 'instrument_id' | 'provider_alias' | 'symbol' | 'name';

export type InstrumentResolution =
  | {
      status: 'resolved';
      query: string;
      matchedBy: InstrumentMatchKind;
      instrument: CanonicalInstrument;
    }
  | {
      status: 'ambiguous';
      query: string;
      matchedBy: InstrumentMatchKind;
      candidates: CanonicalInstrument[];
    }
  | {
      status: 'not_found';
      query: string;
    };

/** UI/error payload for an ambiguous resolution. Omits alias maps. */
export interface InstrumentCandidateSummary {
  instrumentId: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  exchange?: string;
}

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedProviderId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function cloneInstrument(instrument: CanonicalInstrument): CanonicalInstrument {
  return {
    ...instrument,
    nameAliases: instrument.nameAliases ? [...instrument.nameAliases] : undefined,
    providerAliases: instrument.providerAliases.map((alias) => ({ ...alias })),
    externalIds: instrument.externalIds?.map((externalId) => ({ ...externalId })),
  };
}

function validateInstrument(instrument: CanonicalInstrument): void {
  const required: Array<[string, string]> = [
    ['instrumentId', instrument.instrumentId],
    ['symbol', instrument.symbol],
    ['name', instrument.name],
    ['market', instrument.market],
    ['country', instrument.country],
    ['currency', instrument.currency],
  ];
  const missing = required.find(([, value]) => value.trim().length === 0);
  if (missing) throw new Error(`Instrument ${missing[0]} is required.`);
  if (!INSTRUMENT_ASSET_TYPE_SET.has(instrument.assetType)) {
    throw new Error(`Instrument ${instrument.instrumentId} has an invalid assetType.`);
  }

  const providerIds = new Set<string>();
  for (const alias of instrument.providerAliases) {
    if (!alias.providerId.trim() || !alias.symbol.trim()) {
      throw new Error(`Instrument ${instrument.instrumentId} has an incomplete provider alias.`);
    }
    const providerId = normalizedProviderId(alias.providerId);
    if (providerIds.has(providerId)) {
      throw new Error(
        `Instrument ${instrument.instrumentId} has multiple aliases for provider ${providerId}.`
      );
    }
    providerIds.add(providerId);
  }
}

function resolutionOf(
  query: string,
  matchedBy: InstrumentMatchKind,
  matches: CanonicalInstrument[]
): InstrumentResolution | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) {
    return { status: 'resolved', query, matchedBy, instrument: cloneInstrument(matches[0]) };
  }
  return {
    status: 'ambiguous',
    query,
    matchedBy,
    candidates: matches.map(cloneInstrument),
  };
}

function uniqueInstruments(instruments: CanonicalInstrument[]): CanonicalInstrument[] {
  const seen = new Set<string>();
  const unique: CanonicalInstrument[] = [];
  for (const instrument of instruments) {
    const id = normalizedCode(instrument.instrumentId);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(instrument);
  }
  return unique;
}

/**
 * Listing-key helper for catalog authors (`MIC:SYMBOL`).
 *
 * The value identifies one listing, not an issuer. Once stored on a
 * `CanonicalInstrument` it is immutable — ticker changes must update `symbol`
 * and aliases, not mint a new id for the same listing. First-version catalogs
 * use this as a convenient listing key; a full securities master is out of scope.
 */
export function createInstrumentId(exchangeMic: string, symbol: string): string {
  const mic = normalizedCode(exchangeMic);
  const localSymbol = normalizedCode(symbol);
  if (!mic || !localSymbol) throw new Error('Exchange MIC and symbol are required.');
  return `${mic}:${localSymbol}`;
}

/** Narrow unknown provider/router input to a canonical instrument. */
export function isCanonicalInstrument(value: unknown): value is CanonicalInstrument {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.instrumentId === 'string' &&
    record.instrumentId.trim() !== '' &&
    typeof record.symbol === 'string' &&
    record.symbol.trim() !== '' &&
    typeof record.market === 'string' &&
    Array.isArray(record.providerAliases)
  );
}

/** Slim listing fields for ambiguity errors and candidate pickers. */
export function summarizeInstrument(instrument: CanonicalInstrument): InstrumentCandidateSummary {
  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    currency: instrument.currency,
    ...(instrument.exchange ? { exchange: instrument.exchange } : {}),
  };
}

/** Read a canonical id off a stamped payload (object or array of objects). */
export function readInstrumentId(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = readInstrumentId(item);
      if (id) return id;
    }
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const instrumentId = (data as { instrumentId?: unknown }).instrumentId;
  return typeof instrumentId === 'string' && instrumentId.trim() !== ''
    ? instrumentId.trim()
    : undefined;
}

/** Resolve the symbol that one provider expects for a canonical instrument. */
export function getProviderSymbol(
  instrument: CanonicalInstrument,
  providerId: string
): string | undefined {
  const normalizedId = normalizedProviderId(providerId);
  return instrument.providerAliases.find(
    (alias) => normalizedProviderId(alias.providerId) === normalizedId
  )?.symbol;
}

/**
 * Immutable, in-memory index over a versioned instrument catalog.
 *
 * Callers persist `snapshot()` in their storage layer and reconstruct with
 * `fromSnapshot()`. Catalog refresh and vendor lookups remain outside the core
 * domain so the resolver stays deterministic and testable.
 */
export class InstrumentResolver {
  private readonly instruments: CanonicalInstrument[];

  constructor(instruments: readonly CanonicalInstrument[]) {
    const instrumentIds = new Set<string>();
    const providerSymbols = new Set<string>();

    for (const instrument of instruments) {
      validateInstrument(instrument);
      const instrumentId = normalizedCode(instrument.instrumentId);
      if (instrumentIds.has(instrumentId)) {
        throw new Error(`Duplicate instrument id: ${instrument.instrumentId}`);
      }
      instrumentIds.add(instrumentId);

      for (const alias of instrument.providerAliases) {
        const key = `${normalizedProviderId(alias.providerId)}:${normalizedCode(alias.symbol)}`;
        if (providerSymbols.has(key)) {
          throw new Error(`Duplicate provider symbol: ${alias.providerId}:${alias.symbol}`);
        }
        providerSymbols.add(key);
      }
    }

    this.instruments = instruments.map(cloneInstrument);
  }

  static fromSnapshot(snapshot: InstrumentCatalogSnapshot): InstrumentResolver {
    if (snapshot.schemaVersion !== INSTRUMENT_CATALOG_SCHEMA_VERSION) {
      throw new Error(`Unsupported instrument catalog schema: ${snapshot.schemaVersion}`);
    }
    if (!Number.isFinite(snapshot.updatedAt) || snapshot.updatedAt < 0) {
      throw new Error('Instrument catalog updatedAt must be a non-negative epoch timestamp.');
    }
    return new InstrumentResolver(snapshot.instruments);
  }

  snapshot(updatedAt: number): InstrumentCatalogSnapshot {
    if (!Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new Error('Instrument catalog updatedAt must be a non-negative epoch timestamp.');
    }
    return {
      schemaVersion: INSTRUMENT_CATALOG_SCHEMA_VERSION,
      updatedAt,
      instruments: this.instruments.map(cloneInstrument),
    };
  }

  resolve(query: string, options: InstrumentResolutionOptions = {}): InstrumentResolution {
    const originalQuery = query;
    const code = normalizedCode(query);
    const name = normalizedName(query);
    const market = options.market ? normalizedCode(options.market) : undefined;
    const providerId = options.providerId
      ? normalizedProviderId(options.providerId)
      : undefined;
    const candidates = market
      ? this.instruments.filter((instrument) => normalizedCode(instrument.market) === market)
      : this.instruments;

    if (!code) return { status: 'not_found', query: originalQuery };

    const byId = resolutionOf(
      originalQuery,
      'instrument_id',
      candidates.filter((instrument) => normalizedCode(instrument.instrumentId) === code)
    );
    if (byId) return byId;

    if (providerId) {
      const byProviderAlias = resolutionOf(
        originalQuery,
        'provider_alias',
        candidates.filter((instrument) =>
          instrument.providerAliases.some(
            (alias) =>
              normalizedProviderId(alias.providerId) === providerId &&
              normalizedCode(alias.symbol) === code
          )
        )
      );
      if (byProviderAlias) return byProviderAlias;
    }

    if (!providerId) {
      const bySymbol = candidates.filter(
        (instrument) => normalizedCode(instrument.symbol) === code
      );
      const byProviderAlias = candidates.filter((instrument) =>
        instrument.providerAliases.some((alias) => normalizedCode(alias.symbol) === code)
      );
      const merged = uniqueInstruments([...bySymbol, ...byProviderAlias]);
      const matchedBy: InstrumentMatchKind = bySymbol.length > 0 ? 'symbol' : 'provider_alias';
      const byCode = resolutionOf(originalQuery, matchedBy, merged);
      if (byCode) return byCode;
    }

    const byName = resolutionOf(
      originalQuery,
      'name',
      candidates.filter((instrument) =>
        [instrument.name, ...(instrument.nameAliases ?? [])].some(
          (candidateName) => normalizedName(candidateName) === name
        )
      )
    );
    if (byName) return byName;

    return { status: 'not_found', query: originalQuery };
  }

  get(instrumentId: string): CanonicalInstrument | undefined {
    const code = normalizedCode(instrumentId);
    if (!code) return undefined;
    const match = this.instruments.find(
      (instrument) => normalizedCode(instrument.instrumentId) === code
    );
    return match ? cloneInstrument(match) : undefined;
  }

  list(): CanonicalInstrument[] {
    return this.instruments.map(cloneInstrument);
  }
}

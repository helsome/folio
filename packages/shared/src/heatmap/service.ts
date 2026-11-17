import {
  heatmapHoldingValue,
  type HeatmapSnapshot,
  type HeatmapSourceSnapshot,
  type HeatmapTile,
  type InstrumentResolution,
  type Holding,
} from '@finagent/core';
import { CapabilityExecutor } from '../capabilities/executor.ts';
import { createMarketQuoteCapability } from '../capabilities/manifests/market-quote.ts';
import type { MarketDataService } from '../agent/market-data-service.ts';
import { isRecord } from '../guards.ts';

/** Validate the renderer boundary and copy only fields used for local valuation. */
export function parseHeatmapSource(input: unknown): HeatmapSourceSnapshot {
  if (!isRecord(input) || input.schemaVersion !== 1 ||
      (input.kind !== 'watchlist' && input.kind !== 'portfolio') ||
      typeof input.id !== 'string' || input.id.length > 256 ||
      typeof input.revision !== 'string' || input.revision.length > 256 ||
      typeof input.capturedAt !== 'number' || !Number.isFinite(input.capturedAt) ||
      !Array.isArray(input.entries) || input.entries.length > 1000) {
    throw new Error('Invalid heatmap source snapshot.');
  }
  const currency = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error('Invalid heatmap currency.');
    return value;
  };
  const entries = input.entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.symbol !== 'string' || !entry.symbol.trim() || entry.symbol.length > 128) {
      throw new Error('Invalid heatmap symbol.');
    }
    let holding: Holding | undefined;
    if (input.kind === 'portfolio') {
      if (!isRecord(entry.holding)) throw new Error('Missing heatmap holding.');
      holding = { symbol: entry.symbol, name: '', currency: currency(entry.holding.currency) };
      for (const field of ['quantity', 'marketValue', 'marketValueBase'] as const) {
        const value = entry.holding[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
          throw new Error('Invalid heatmap valuation.');
        }
        holding[field] = value as number | undefined;
      }
    }
    return { symbol: entry.symbol.trim(), ...(holding ? { holding } : {}) };
  });
  return {
    schemaVersion: 1, id: input.id, revision: input.revision, kind: input.kind,
    capturedAt: input.capturedAt, baseCurrency: currency(input.baseCurrency),
    valuationCurrency: currency(input.valuationCurrency), entries,
  };
}

export class HeatmapService {
  constructor(private readonly options: {
    marketData: MarketDataService;
    resolve: (query: string) => InstrumentResolution;
    now?: () => number;
  }) {}

  async load(source: HeatmapSourceSnapshot, signal?: AbortSignal): Promise<HeatmapSnapshot> {
    const now = this.options.now ?? Date.now;
    const market = this.options.marketData;
    const tiles = new Map<string, HeatmapTile>();
    const unresolved: HeatmapSnapshot['unresolved'] = [];
    for (const entry of source.entries) {
      const resolution = this.options.resolve(entry.symbol);
      if (resolution.status !== 'resolved') {
        unresolved.push({ symbol: entry.symbol, reason: resolution.status });
        continue;
      }
      const instrument = resolution.instrument;
      const valuation = entry.holding
        ? heatmapHoldingValue(entry.holding, source.baseCurrency, source.valuationCurrency)
        : { value: null };
      const previous = tiles.get(instrument.instrumentId);
      if (previous) {
        if (previous.exclusion === 'short' || valuation.exclusion === 'short') previous.exclusion = 'short';
        else if (previous.valueBase === null || valuation.value === null) previous.exclusion = valuation.exclusion ?? previous.exclusion;
        else previous.exclusion = previous.valueBase + valuation.value > 0 ? undefined : 'zero';
        previous.valueBase = previous.valueBase === null || valuation.value === null ? null : previous.valueBase + valuation.value;
        continue;
      }
      tiles.set(instrument.instrumentId, {
        instrument,
        workspaceSymbol: instrument.providerAliases.find((alias) => alias.providerId === 'longbridge')?.symbol ?? instrument.instrumentId,
        changePercent: null, state: 'unknown', valueBase: valuation.value,
        weight: null, exclusion: valuation.exclusion,
      });
    }
    const list = [...tiles.values()];
    const statuses = list.length ? await market.getMarketStatus(signal).catch(() => []) : [];
    if (signal?.aborted) throw new Error('Heatmap request aborted.');
    // Use the same bounded, abort-aware batch scheduler as research/risk workflows.
    const template = createMarketQuoteCapability();
    await new CapabilityExecutor({ now }).runAll(list.map((tile) => ({
      input: {},
      cap: {
        ...template,
        async execute(_input: unknown, ctx) {
          const key = tile.workspaceSymbol;
          try {
            const result = await market.getQuoteResult(key, ctx?.signal);
            const provenance = result.provenance;
            if ([provenance.instrumentId, result.data.instrumentId]
              .some((instrumentId) => instrumentId !== undefined && instrumentId !== tile.instrument.instrumentId)) {
              throw new Error('Quote instrument mismatch.');
            }
            tile.provenance = provenance;
            const quote = result.data;
            const time = provenance.marketTime;
            if (provenance.providerId !== 'demo' && Number.isFinite(quote.changePercent) &&
                Number.isFinite(quote.lastPrice) && Number.isFinite(quote.prevClose) && quote.lastPrice > 0 && quote.prevClose > 0 &&
                time !== undefined && time > 0 && time <= now() + 60_000) {
              tile.changePercent = quote.changePercent;
              const session = statuses.find((status) => status.market === tile.instrument.market)?.status;
              const closed = session !== undefined && !/(open|trading|continuous)/i.test(session);
              tile.state = provenance.stale || provenance.delayed || closed || now() - time > 15 * 60_000 ? 'stale' : 'current';
            }
          } catch { /* Missing quotes remain unknown, including provider failure. */ }
          if (!ctx?.signal?.aborted) {
            try {
              const profile = await market.getStaticInfo(key, ctx?.signal);
              if (!profile.instrumentId || profile.instrumentId === tile.instrument.instrumentId) tile.industry = profile.industry;
            } catch { /* Missing classifications belong to the unknown industry group. */ }
          }
          return { data: null, provenance: { provider: 'heatmap', fetchedAt: now(), stale: false } };
        },
      },
    })), { concurrency: 4, timeoutMs: 20_000, signal });
    if (signal?.aborted) throw new Error('Heatmap request aborted.');
    for (const tile of list) tile.session = statuses.find((status) => status.market === tile.instrument.market)?.status;
    const longs = list.filter((tile) => tile.exclusion !== 'short' && tile.exclusion !== 'zero');
    const total = longs.reduce((sum, tile) => sum + (tile.valueBase ?? 0), 0);
    if (source.kind === 'watchlist' && list.length > 0) {
      for (const tile of list) tile.weight = 1 / list.length;
    }
    const weightedAvailable = source.kind === 'portfolio' && unresolved.length === 0 && longs.length > 0 &&
      longs.every((tile) => tile.exclusion === undefined && tile.valueBase !== null) && Number.isFinite(total) && total > 0;
    if (weightedAvailable) for (const tile of longs) tile.weight = tile.valueBase! / total;
    const { schemaVersion, id, revision, kind, capturedAt, baseCurrency, valuationCurrency } = source;
    return {
      schemaVersion: 1,
      source: { schemaVersion, id, revision, kind, capturedAt, baseCurrency, valuationCurrency },
      fetchedAt: now(), tiles: list, unresolved, weightedAvailable,
    };
  }
}

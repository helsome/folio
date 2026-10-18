import type { CanonicalInstrument } from './instrument.ts';
import type { Holding } from './account.ts';
import type { ProviderProvenance } from './provider.ts';
import type { StaticInfo } from './index.ts';

/** Immutable membership/valuation input. Revisions change with source contents. */
export interface HeatmapSourceSnapshot {
  schemaVersion: 1;
  id: string;
  revision: string;
  kind: 'watchlist' | 'portfolio';
  capturedAt: number;
  baseCurrency?: string;
  /** Currency in which the original snapshot reports marketValueBase. */
  valuationCurrency?: string;
  entries: Array<{ symbol: string; holding?: Holding }>;
}

export type HeatmapExclusion = 'short' | 'missing-value' | 'currency' | 'zero';

export type HeatmapSnapshotSource = Omit<HeatmapSourceSnapshot, 'entries'>;

export interface HeatmapTile {
  instrument: CanonicalInstrument;
  /** Existing workspace symbol, bound to this canonical listing. */
  workspaceSymbol: string;
  industry?: StaticInfo['industry'];
  changePercent: number | null;
  state: 'current' | 'stale' | 'unknown';
  provenance?: ProviderProvenance;
  session?: string;
  valueBase: number | null;
  weight: number | null;
  exclusion?: HeatmapExclusion;
}

export interface HeatmapSnapshot {
  schemaVersion: 1;
  source: HeatmapSnapshotSource;
  fetchedAt: number;
  tiles: HeatmapTile[];
  unresolved: Array<{ symbol: string; reason: 'not_found' | 'ambiguous' }>;
  /** Weighted area is available only when every long position is comparable. */
  weightedAvailable: boolean;
}

export function heatmapHoldingValue(
  holding: Holding,
  baseCurrency?: string,
  valuationCurrency?: string,
): { value: number | null; exclusion?: HeatmapExclusion } {
  const finite = (value: number | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if ((holding.quantity ?? 0) < 0 || (holding.marketValue ?? 0) < 0 || (holding.marketValueBase ?? 0) < 0) {
    return { value: null, exclusion: 'short' };
  }
  if (!baseCurrency) return { value: null, exclusion: 'currency' };
  const value = baseCurrency === valuationCurrency && finite(holding.marketValueBase)
    ? holding.marketValueBase
    : holding.currency === baseCurrency && finite(holding.marketValue) ? holding.marketValue : null;
  if (value === null) {
    return { value: null, exclusion: holding.currency !== baseCurrency ? 'currency' : 'missing-value' };
  }
  if (value === 0) return { value, exclusion: 'zero' };
  return { value };
}

/** Fixed daily-move buckets, shared by the visible legend and tile rendering. */
export function heatmapColor(tile: Pick<HeatmapTile, 'state' | 'changePercent'>): string {
  if (tile.state !== 'current' || tile.changePercent === null) return '#6b7280';
  const change = tile.changePercent;
  if (change <= -3) return '#9f2434';
  if (change < -1) return '#c74653';
  if (change < 0) return '#a8646c';
  if (change === 0) return '#575c63';
  if (change < 1) return '#428077';
  if (change < 3) return '#18786a';
  return '#075e50';
}

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

const HEATMAP_RED = '#F23645';
const HEATMAP_NEUTRAL = '#343a40';
const HEATMAP_GREEN = '#089981';
const HEATMAP_STALE = '#6b7280';
const HEATMAP_UNKNOWN = '#4b5563';

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function blend(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Continuous red-to-green daily-move palette, capped at +/-3%. */
export function heatmapColor(tile: Pick<HeatmapTile, 'state' | 'changePercent'>): string {
  if (tile.state === 'stale') return HEATMAP_STALE;
  if (tile.state !== 'current' || tile.changePercent === null) return HEATMAP_UNKNOWN;
  const change = Math.max(-3, Math.min(3, tile.changePercent));
  return change < 0
    ? blend(HEATMAP_RED, HEATMAP_NEUTRAL, (change + 3) / 3)
    : blend(HEATMAP_NEUTRAL, HEATMAP_GREEN, change / 3);
}

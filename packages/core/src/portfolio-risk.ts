import type { EvidenceRef } from './research.ts';

/**
 * Portfolio Risk domain — allocation, concentration, and risk signals derived
 * from portfolio + market capabilities.
 */

export type RiskSignalKind =
  | 'concentration'
  | 'sector_exposure'
  | 'large_position'
  | 'upcoming_earnings'
  | 'news_exposure'
  | 'drawdown';

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface RiskSignal {
  kind: RiskSignalKind;
  severity: RiskSeverity;
  title: string;
  detail: string;
  symbol?: string;
  evidence?: EvidenceRef[];
}

export interface AllocationItem {
  symbol: string;
  marketValue: number;
  /** Fraction of total portfolio market value, 0..1. */
  weight: number;
}

export interface PortfolioRiskReport {
  id: string;
  generatedAt: number;
  /** Agent-written summary of the top findings. */
  summary: string;
  allocation: AllocationItem[];
  /** Positions without a comparable base-currency value, and the denominator used for visible weights. */
  allocationCoverage?: {
    excludedSymbols: string[];
    basis: 'portfolio' | 'available-positions';
  };
  concentration: {
    top1Weight: number;
    top5Weight: number;
    /** Herfindahl–Hirschman index over position weights, 0..1. */
    herfindahl: number;
  };
  signals: RiskSignal[];
  /** Capability runs backing this report (evidence trail). */
  capabilityRuns: Array<{
    capabilityId: string;
    status: 'success' | 'failed' | 'unavailable' | 'cancelled';
    error?: string;
  }>;
}


/** Display state for a heatmap tile; unknown data must remain visible as unknown. */
export type HeatmapTileStatus = 'ready' | 'stale' | 'unknown';

/** Provider-neutral input for the watchlist/portfolio heatmap model. */
export interface HeatmapTileInput {
  /** Stable canonical identity when available; symbol is the fallback identity. */
  instrumentId?: string;
  symbol: string;
  name?: string;
  industry?: string;
  changePercent?: number;
  /** Base-currency value. Raw marketValue is accepted only when already comparable. */
  marketValue?: number;
  dataStatus?: HeatmapTileStatus;
}

/** Deterministic tile model consumed by a future heatmap renderer. */
export interface HeatmapTile {
  key: string;
  symbol: string;
  name: string;
  group: string;
  /** Watchlist tiles are equal weight; portfolio tiles use comparable values. */
  weight?: number;
  changePercent?: number;
  status: HeatmapTileStatus;
}

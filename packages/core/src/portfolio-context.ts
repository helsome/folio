/** Explicit, versioned user context. It is never an implicit model profile. */

export type ContextKind = 'watchlist' | 'portfolio';

export interface WatchlistInstrument {
  instrumentId: string;
  tags?: string[];
  thesis?: string;
  notes?: string;
}

export interface VersionedWatchlist {
  id: string;
  name: string;
  version: number;
  instruments: WatchlistInstrument[];
  createdAt: number;
  updatedAt: number;
}

export interface PortfolioPositionContext {
  instrumentId: string;
  quantity?: number;
  weight?: number;
  costBasis?: number;
  nativeCurrency: string;
  thesis?: string;
  notes?: string;
}

export interface VersionedPortfolioContext {
  id: string;
  name: string;
  version: number;
  positions: PortfolioPositionContext[];
  asOf: number;
  createdAt: number;
  updatedAt: number;
}

export type ContextDocument = VersionedWatchlist | VersionedPortfolioContext;

export interface ContextSelection {
  kind: ContextKind;
  id: string;
}

export interface ContextSnapshot {
  id: string;
  kind: ContextKind;
  sourceId: string;
  sourceVersion: number;
  createdAt: number;
  /** Frozen, optionally relevance-filtered copy actually supplied to the run. */
  document: ContextDocument;
}

export interface RunContextBinding {
  runId: string;
  sessionId: string;
  branchId: string;
  snapshotIds: string[];
  boundAt: number;
}

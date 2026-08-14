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

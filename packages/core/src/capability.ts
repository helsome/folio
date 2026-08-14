import type { TSchema } from '@sinclair/typebox';

/**
 * Finance Capability domain — the single source of truth for every piece of
 * financial functionality Folio can execute.
 *
 * A capability is a named, schema-validated, read-only (this round) operation
 * over a finance data provider. The registry drives three consumers:
 *
 *   1. Agent tools (Pi extension)   — generated from manifests
 *   2. UI availability              — metadata only, via IPC
 *   3. Product workflows            — Research, Alerts, Portfolio Risk, Compare
 *
 * Capability ids use a `<namespace>.<name>` convention, e.g. `market.quote`.
 */

export type CapabilityCategory = 'market' | 'company' | 'research' | 'portfolio' | 'event';

export type CapabilityRiskLevel = 'read' | 'write';

export type CapabilityAuth = 'public' | 'account' | 'trade';

/** Capability id, e.g. `market.quote`. Format: /^[a-z]+\.[a-zA-Z]+$/ */
export type CapabilityId = string;

/**
 * Where a result came from and how fresh it is. Every capability result MUST
 * carry provenance; structured `data` is the source of truth, `summary` is an
 * optional short human/agent-readable condensation.
 */
export interface CapabilityProvenance {
  /** Provider name, e.g. `longbridge`. */
  provider: string;
  /** Epoch ms at which the data was fetched. */
  fetchedAt: number;
  /** Epoch ms of the data's own market timestamp, when known. */
  marketTime?: number;
  /** True when the data may be outdated relative to the market. */
  stale: boolean;
}

export interface CapabilityResult<T> {
  data: T;
  provenance: CapabilityProvenance;
  summary?: string;
}

export type CapabilityRunStatus = 'success' | 'failed' | 'unavailable' | 'cancelled';

/** One execution of a capability, recorded for observability and evidence. */
export interface CapabilityRunRecord {
  id: string;
  capabilityId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: CapabilityRunStatus;
  error?: string;
  provenance?: CapabilityProvenance;
}

export interface CapabilityExecutionContext {
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * A single finance capability. `inputSchema` is a TypeBox schema (the Pi tool
 * adapter and main-process workflows both validate with it, so there is no
 * schema drift). `execute` performs exactly one provider operation and returns
 * structured data + provenance.
 */
export interface FinanceCapability<TInput = unknown, TOutput = unknown> {
  /** Namespaced id, e.g. `market.quote`. */
  id: CapabilityId;
  /** Short display name, e.g. `Quote`. */
  name: string;
  /** Agent-facing description of what the capability returns and when to use it. */
  description: string;
  category: CapabilityCategory;
  riskLevel: CapabilityRiskLevel;
  auth: CapabilityAuth;
  /** Agent-facing tool name, e.g. `get_quote`. Unique across capabilities. */
  toolName: string;
  /** TypeBox schema describing the validated input. */
  inputSchema: TSchema;
  execute(input: TInput, ctx?: CapabilityExecutionContext): Promise<CapabilityResult<TOutput>>;
}

export interface CapabilityQueryFilter {
  category?: CapabilityCategory;
  auth?: CapabilityAuth;
  riskLevel?: CapabilityRiskLevel;
}

/** Read-only index over registered capabilities. */
export interface CapabilityRegistry {
  list(): FinanceCapability[];
  get(id: CapabilityId): FinanceCapability | undefined;
  query(filter?: CapabilityQueryFilter): FinanceCapability[];
}

/**
 * Capability ids targeted by Folio V3. Implementations register under these
 * ids; skills reference them from their capability requirement maps. Ids not
 * yet implemented simply report as missing in skill readiness.
 */
export const TARGET_CAPABILITY_IDS = [
  // market
  'market.quote',
  'market.kline',
  'market.intraday',
  'market.depth',
  'market.trades',
  'market.capitalFlow',
  'market.sentiment',
  'market.status',
  // company
  'company.profile',
  'company.valuation',
  'company.financials',
  'company.dividends',
  'company.earnings',
  'company.ratings',
  // research
  'research.news',
  'research.events',
  // portfolio
  'portfolio.summary',
  'portfolio.positions',
  'portfolio.assets',
  'portfolio.cashFlow',
] as const;

export type TargetCapabilityId = (typeof TARGET_CAPABILITY_IDS)[number];

/**
 * V4 Financial Provider Platform contracts.
 *
 * Three SEPARATE domains — never conflate them (spec §2):
 *   - `LlmProvider`           — who supplies agent intelligence (Anthropic,
 *                               OpenAI-compatible, Google, …)
 *   - `FinancialDataProvider` — who supplies market data (Longbridge, …)
 *   - `BrokerAccountProvider` — whose brokerage account portfolio data belongs
 *                               to (Longbridge brokerage account, …)
 *
 * A single vendor product (Longbridge) MAY implement more than one domain, but
 * the domains are separate interfaces and separate health/lifecycle state.
 *
 * Provider-agnosticism (spec §4): results returned through these contracts
 * carry `ProviderProvenance`; Longbridge-specific fields MUST NOT leak into
 * research, agent, UI, portfolio, or compare layers. Providers map their raw
 * vendor output into the neutral output types in `market-data.ts` and
 * `account.ts`.
 */
import type { CapabilityId } from './capability.ts';
import type { AccountAssets, CashFlowRecord, PortfolioSnapshot } from './account.ts';

// ── Domains ────────────────────────────────────────────────────────────────

export type ProviderKind = 'financial-data' | 'broker-account' | 'llm';

/** Marker for LLM providers (the pre-V4 "LLM provider" concept, renamed). */
export interface LlmProvider {
  kind: 'llm';
  id: string;
  name: string;
}

// ── Status / Health ────────────────────────────────────────────────────────

/**
 * Connection lifecycle for a financial or broker provider (spec §8).
 * `not-installed` = runtime absent (e.g. Longbridge CLI missing);
 * `permission-limited` = connected but some entitlement missing (detail in
 * `permissions`); `expired` = token/session needs re-auth.
 */
export type FinancialProviderStatus =
  | 'not-installed'
  | 'not-connected'
  | 'connecting'
  | 'connected'
  | 'permission-limited'
  | 'expired'
  | 'error';

/** One named permission/entitlement (e.g. US quotes, portfolio access). */
export interface ProviderPermission {
  id: string;
  label: string;
  granted: boolean;
}

/**
 * Health snapshot for one provider. `status()` MUST be cheap enough to call
 * on render and on demand ("Test Connection").
 */
export interface ProviderHealth {
  status: FinancialProviderStatus;
  /** Epoch ms of this check. */
  lastCheck: number;
  /** User-safe message; NEVER raw CLI/vendor output (spec §19). */
  message?: string;
  /** Vendor-assigned account/identity label, when available. */
  account?: string;
  /** Region the connection is authenticated for, e.g. `CN`, `SG`. */
  region?: string;
  /** Per-entitlement grants; empty = unknown. */
  permissions?: ProviderPermission[];
  /** Last status() round-trip duration. */
  latencyMs?: number;
}

// ── Markets / Coverage ─────────────────────────────────────────────────────

export interface Market {
  id: string;
  name: string;
}

export const DEFAULT_MARKETS: readonly Market[] = [
  { id: 'US', name: 'United States' },
  { id: 'HK', name: 'Hong Kong' },
  { id: 'CN', name: 'China A-shares' },
  { id: 'SG', name: 'Singapore' },
] as const;

/**
 * Which capabilities and markets one provider covers (spec §7). The
 * Connections UI renders this as the capability matrix.
 */
export interface ProviderCoverage {
  providerId: string;
  capabilities: CapabilityId[];
  markets: Market[];
}

// ── Results / Provenance / Errors ──────────────────────────────────────────

/**
 * Where data came from and how fresh it is. `providerId`/`providerName` are
 * the ACTUAL provider that answered — never faked when a fallback served the
 * request (spec §62).
 */
export interface ProviderProvenance {
  providerId: string;
  providerName: string;
  /** Epoch ms when the data was fetched. */
  fetchedAt: number;
  /** Epoch ms of the data's own market timestamp, when known. */
  marketTime?: number;
  /** True when the market was closed / data is delayed relative to live. */
  delayed?: boolean;
  /** True when the data may be outdated relative to the market. */
  stale: boolean;
}

/**
 * Provider failure. `code` is a stable machine code (e.g. `AUTH_EXPIRED`,
 * `RATE_LIMITED`, `UNSUPPORTED_CAPABILITY`, `TIMEOUT`, `PARSE_FAILURE`);
 * `message` is user-safe — raw vendor output is forbidden.
 */
export interface ProviderError {
  code: string;
  message: string;
  /** True when an immediate retry may succeed (transient). */
  retryable?: boolean;
}

export type ProviderResult<T> =
  | { ok: true; data: T; provenance: ProviderProvenance }
  | { ok: false; error: ProviderError };

// ── Provider interfaces ────────────────────────────────────────────────────

/**
 * Market-data provider (spec §4). Capability-based execute; the provider
 * declares its own coverage. Implementations MUST honor `signal` (abort →
 * ProviderError code `ABORTED`).
 */
export interface FinancialDataProvider {
  kind: 'financial-data';
  id: string;
  name: string;

  status(): Promise<ProviderHealth>;

  /** Capability ids this provider can serve. */
  capabilities(): CapabilityId[];

  markets(): Market[];

  execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>>;
}

/** One brokerage account exposed by a broker connection. */
export interface BrokerAccount {
  id: string;
  /** User-facing label, e.g. `US Margin (D1234567)`. */
  name: string;
  /** Primary currency of this account, e.g. `USD`. */
  currency?: string;
  region?: string;
}

/**
 * Broker/account provider (spec §5) — market data and account data are
 * DIFFERENT capabilities and different lifecycles. Portfolio-shaped methods
 * accept an optional `accountId`; implementations with a single account use
 * their default when omitted. Results use the neutral account domain in
 * `account.ts` — vendor fields never leak past this interface.
 */
export interface BrokerAccountProvider {
  kind: 'broker-account';
  id: string;
  name: string;

  status(): Promise<ProviderHealth>;

  accounts(): Promise<ProviderResult<BrokerAccount[]>>;

  getPortfolio(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<PortfolioSnapshot>>;
  getPositions(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<PortfolioSnapshot['holdings']>>;
  getAssets(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<AccountAssets[]>>;
  getCashFlow(
    accountId?: string,
    options?: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<CashFlowRecord[]>>;
}

// ── Routing ────────────────────────────────────────────────────────────────

/**
 * Routing configuration (spec §6). V4 is PRIMARY + OPTIONAL FALLBACK — no
 * smart routing. Fallback is consulted only when the primary fails, aborts,
 * or does not support the capability.
 */
export interface ProviderRoutingConfig {
  primary: string;
  fallback?: string;
}

/**
 * Router contract (implemented in `@finagent/shared/providers`). Capability →
 * provider chain; results carry the actual provider's provenance. The router
 * also implements `CapabilityFetchers` so manifests/research/UI remain
 * untouched by routing.
 */
export interface FinancialProviderRouter {
  register(provider: FinancialDataProvider | BrokerAccountProvider): void;
  get(id: string): FinancialDataProvider | BrokerAccountProvider | undefined;
  list(): (FinancialDataProvider | BrokerAccountProvider)[];
  setRouting(config: ProviderRoutingConfig): void;
  getRouting(): ProviderRoutingConfig;
  /** Coverage matrix across all registered providers (spec §7). */
  coverage(): ProviderCoverage[];
  execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>>;
}

/** The global router instance id — never re-create per request. */
export const PROVIDER_ROUTER_SYMBOL = Symbol.for('folio.financialProviderRouter');

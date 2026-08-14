/**
 * Provider-neutral brokerage account domain (V4).
 *
 * These types are the boundary between provider adapters and the product:
 * adapters normalize raw vendor output into these shapes; UI/research/agent
 * layers consume ONLY these shapes. Rules (spec §16–19):
 *   - every numeric field is `number | undefined`; `undefined` = unknown,
 *     and consumers render it as "—" (NEVER NaN, NEVER [object Object])
 *   - `currency` is carried per holding/account; UI formats with
 *     `Intl.NumberFormat` (USD/HKD/CNY/SGD at minimum; unknown currencies
 *     fall back to a plain number + code)
 *   - names are unicode-safe (Chinese/English both fine)
 */

/** One equity holding inside a portfolio snapshot. */
export interface Holding {
  symbol: string;
  /** Vendor display name, unicode-safe; empty when unknown. */
  name: string;
  /** ISO 4217 currency this position is denominated in. */
  currency?: string;
  quantity?: number;
  availableQuantity?: number;
  costPrice?: number;
  marketPrice?: number;
  marketValue?: number;
  /** Market value converted into the portfolio base currency, when the vendor reports it. */
  marketValueBase?: number;
  unrealizedPnL?: number;
  /** Percentage, 0–100 (already ×100), when the vendor reports it. */
  unrealizedPnLPercent?: number;
  prevClose?: number;
}

/** Per-market/per-account slice of the portfolio. */
export interface PortfolioAccount {
  /** Stable account id; the default account when only one exists. */
  id: string;
  /** User-facing label (unicode-safe). */
  name: string;
  /** Market id, e.g. `US`, `HK`. */
  market?: string;
  currency?: string;
  netAssets?: number;
  marketValue?: number;
  cash?: number;
  pnl?: number;
  todayPnL?: number;
  frozenCash?: number;
  withdrawCash?: number;
}

/**
 * A complete, normalized portfolio snapshot. All `undefined` numerics mean
 * "unavailable", never a broken parse.
 */
export interface PortfolioSnapshot {
  /** ISO 4217 base currency the vendor reports in. */
  baseCurrency?: string;
  totalAssets?: number;
  marketValue?: number;
  cash?: number;
  totalPnL?: number;
  todayPnL?: number;
  riskLevel?: string;
  accounts: PortfolioAccount[];
  holdings: Holding[];
  /** Epoch ms at which the snapshot was fetched. */
  fetchedAt: number;
  /** Epoch ms of the vendor's own snapshot time, when known. */
  marketTime?: number;
}

/** Cash-flow / ledger record (deposits, withdrawals, dividends, settlements). */
export interface CashFlowRecord {
  /** Epoch seconds. */
  timestamp?: number;
  currency?: string;
  /** Numeric amount; negative = outflow. */
  amount?: number;
  /** Vendor business-type code when available. */
  businessType?: string;
  /** Human-readable flow name (unicode-safe). */
  flowName?: string;
  description?: string;
  symbol?: string;
}

/** Assets overview: buying power, margins, per-currency cash. */
export interface AccountAssets {
  currency?: string;
  netAssets?: number;
  totalCash?: number;
  buyPower?: number;
  maxFinanceAmount?: number;
  initMargin?: number;
  maintenanceMargin?: number;
  marginCall?: number;
  riskLevel?: string;
  cashInfos: {
    currency?: string;
    availableCash?: number;
    frozenCash?: number;
    settlingCash?: number;
    withdrawCash?: number;
  }[];
}

/**
 * Parse-failure classification for the product UI (spec §19). The UI maps
 * these to distinct empty/error states — never one "Portfolio unavailable:
 * <raw string>" for everything.
 */
export type PortfolioFailureKind =
  | 'not-connected'
  | 'no-account-permission'
  | 'empty'
  | 'partial'
  | 'provider-error'
  | 'parse-error'
  | 'timeout';

export interface PortfolioFailure {
  kind: PortfolioFailureKind;
  /** User-safe message. Raw vendor output is forbidden. */
  message: string;
  /** True when at least a partial snapshot was recovered. */
  partialData?: boolean;
}

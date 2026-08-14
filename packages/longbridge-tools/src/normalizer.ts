/**
 * PortfolioNormalizer — maps raw `longbridge` CLI JSON into the provider-neutral
 * account domain (`@finagent/core` `account.ts`). This is the single place that
 * knows the vendor's wire shape for portfolio data; everything downstream
 * (fetchers, capabilities, risk service, UI) consumes ONLY the neutral shapes.
 *
 * Rules (spec §15–19, 34):
 *   - every numeric is `number | undefined`; `undefined` = unavailable. NEVER NaN.
 *   - numeric string | number | null | undefined | '' all coerce safely.
 *   - names are unicode-safe passthrough (Chinese/English both fine).
 *   - per-holding and per-account currency is preserved.
 *   - raw CLI output NEVER appears in a user-facing message; it is only kept in
 *     `LongBridgeError.debug` (never rendered, never sent over IPC).
 */

import type {
  AccountAssets,
  CashFlowRecord,
  Holding,
  PortfolioAccount,
  PortfolioFailure,
  PortfolioSnapshot,
} from '@finagent/core';
import { isLongBridgeError } from './errors.ts';

// ── Raw wire shapes (real `longbridge --format json` output) ───────────────

export interface RawPortfolioOverview {
  total_asset?: unknown;
  market_cap?: unknown;
  total_cash?: unknown;
  total_pl?: unknown;
  total_today_pl?: unknown;
  margin_call?: unknown;
  risk_level?: unknown;
  credit_limit?: unknown;
  leverage_ratio?: unknown;
  fund_market_value?: unknown;
  currency?: unknown;
}

export interface RawMarketAccount {
  market?: unknown;
  currency?: unknown;
  net_assets?: unknown;
  market_value?: unknown;
  pl?: unknown;
  today_pl?: unknown;
  balance?: unknown;
  frozen_cash?: unknown;
  withdraw_cash?: unknown;
  max_buy_limit?: unknown;
}

export interface RawPortfolioHolding {
  symbol?: unknown;
  name?: unknown;
  currency?: unknown;
  quantity?: unknown;
  available_quantity?: unknown;
  cost_price?: unknown;
  market_value?: unknown;
  market_value_usd?: unknown;
  market_price?: unknown;
  prev_close?: unknown;
}

export interface RawCashBalance {
  currency?: unknown;
  total_amount?: unknown;
  balance?: unknown;
  frozen_cash?: unknown;
  withdraw_cash?: unknown;
}

export interface RawPortfolioResponse {
  overview?: RawPortfolioOverview;
  market_accounts?: Record<string, RawMarketAccount>;
  holdings?: RawPortfolioHolding[];
  cash_balances?: RawCashBalance[];
}

/** One raw equity position from the `positions` command. */
export interface RawPosition {
  symbol?: unknown;
  name?: unknown;
  quantity?: unknown;
  available?: unknown;
  cost_price?: unknown;
  currency?: unknown;
  market?: unknown;
}

export interface RawCashInfo {
  available_cash?: unknown;
  currency?: unknown;
  frozen_cash?: unknown;
  settling_cash?: unknown;
  withdraw_cash?: unknown;
}

export interface RawAssetsResponse {
  buy_power?: unknown;
  cash_infos?: RawCashInfo[];
  currency?: unknown;
  init_margin?: unknown;
  maintenance_margin?: unknown;
  margin_call?: unknown;
  max_finance_amount?: unknown;
  net_assets?: unknown;
  remaining_finance_amount?: unknown;
  risk_level?: unknown;
  total_cash?: unknown;
}

export interface RawCashFlowRecord {
  balance?: unknown;
  business_type?: unknown;
  currency?: unknown;
  description?: unknown;
  flow_name?: unknown;
  symbol?: unknown;
  time?: unknown;
}

// ── Numeric + code helpers ─────────────────────────────────────────────────

/** Coerce number | numeric string | null | undefined | '' → finite number, else undefined. */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Non-empty string or undefined (unicode-safe passthrough). */
function toCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : undefined;
}

/** Non-empty display string or undefined. */
function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

/**
 * Normalize a timestamp-like value to epoch seconds. Handles numbers (assumed
 * epoch seconds), numeric strings, `YYYY.MM.DD`, and `YYYY-MM-DD HH:mm:ss` /
 * ISO date strings. Returns `undefined` when unparseable.
 */
export function toEpochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '0') return undefined;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : undefined;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

/** Unrealized P&L as `(market − cost) × qty`, or undefined when any input is missing. */
export function computeUnrealizedPnL(
  costPrice: number | undefined,
  marketPrice: number | undefined,
  quantity: number | undefined
): number | undefined {
  if (costPrice === undefined || marketPrice === undefined || quantity === undefined) {
    return undefined;
  }
  return (marketPrice - costPrice) * quantity;
}

/** Unrealized P&L percent (already ×100), computed when the vendor omits it. */
export function computeUnrealizedPnLPercent(
  costPrice: number | undefined,
  marketPrice: number | undefined
): number | undefined {
  if (costPrice === undefined || marketPrice === undefined || costPrice === 0) {
    return undefined;
  }
  return ((marketPrice - costPrice) / costPrice) * 100;
}

// ── Normalizers ────────────────────────────────────────────────────────────

function normalizeHolding(h: RawPortfolioHolding | undefined): Holding {
  const quantity = toFiniteNumber(h?.quantity);
  const costPrice = toFiniteNumber(h?.cost_price);
  const marketPrice = toFiniteNumber(h?.market_price);
  const symbol = toText(h?.symbol) ?? '';
  return {
    symbol,
    name: toText(h?.name) ?? '',
    currency: toCode(h?.currency),
    quantity,
    availableQuantity: toFiniteNumber(h?.available_quantity),
    costPrice,
    marketPrice,
    marketValue: toFiniteNumber(h?.market_value),
    marketValueBase: toFiniteNumber(h?.market_value_usd),
    unrealizedPnL: computeUnrealizedPnL(costPrice, marketPrice, quantity),
    unrealizedPnLPercent: computeUnrealizedPnLPercent(costPrice, marketPrice),
    prevClose: toFiniteNumber(h?.prev_close),
  };
}

function normalizeAccount(market: string, a: RawMarketAccount | undefined): PortfolioAccount {
  const id = toText(a?.market) ?? market;
  return {
    id,
    name: id,
    market: id,
    currency: toCode(a?.currency),
    netAssets: toFiniteNumber(a?.net_assets),
    marketValue: toFiniteNumber(a?.market_value),
    cash: toFiniteNumber(a?.balance),
    pnl: toFiniteNumber(a?.pl),
    todayPnL: toFiniteNumber(a?.today_pl),
    frozenCash: toFiniteNumber(a?.frozen_cash),
    withdrawCash: toFiniteNumber(a?.withdraw_cash),
  };
}

/** Map the real `longbridge portfolio --format json` body into a neutral snapshot. */
export function normalizePortfolioSnapshot(
  raw: RawPortfolioResponse | undefined,
  fetchedAt = Date.now()
): PortfolioSnapshot {
  const overview = raw?.overview;
  const marketAccounts = raw?.market_accounts;
  const accounts: PortfolioAccount[] = [];
  if (marketAccounts && typeof marketAccounts === 'object' && !Array.isArray(marketAccounts)) {
    for (const [market, account] of Object.entries(marketAccounts)) {
      accounts.push(normalizeAccount(market, account as RawMarketAccount | undefined));
    }
    accounts.sort((a, b) => a.id.localeCompare(b.id));
  }

  const holdings = (Array.isArray(raw?.holdings) ? raw.holdings : [])
    .map(normalizeHolding)
    .filter((h) => h.symbol !== '');

  return {
    baseCurrency: toCode(overview?.currency),
    totalAssets: toFiniteNumber(overview?.total_asset),
    marketValue: toFiniteNumber(overview?.market_cap),
    cash: toFiniteNumber(overview?.total_cash),
    totalPnL: toFiniteNumber(overview?.total_pl),
    todayPnL: toFiniteNumber(overview?.total_today_pl),
    riskLevel: toText(overview?.risk_level),
    accounts,
    holdings,
    fetchedAt,
  };
}

/** Map the raw `positions` command body into neutral holdings (cost/quantity only). */
export function normalizePositions(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): Holding => {
      const position = p as RawPosition | undefined;
      const quantity = toFiniteNumber(position?.quantity);
      const costPrice = toFiniteNumber(position?.cost_price);
      return {
        symbol: toText(position?.symbol) ?? '',
        name: toText(position?.name) ?? '',
        currency: toCode(position?.currency),
        quantity,
        availableQuantity: toFiniteNumber(position?.available),
        costPrice,
      };
    })
    .filter((h) => h.symbol !== '');
}

/** Map the raw `assets` command body into neutral per-currency account assets. */
export function normalizeAssets(raw: unknown): AccountAssets[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): AccountAssets | undefined => {
      const a = entry as RawAssetsResponse | undefined;
      if (!a || typeof a !== 'object') return undefined;
      return {
        currency: toCode(a.currency),
        netAssets: toFiniteNumber(a.net_assets),
        totalCash: toFiniteNumber(a.total_cash),
        buyPower: toFiniteNumber(a.buy_power),
        maxFinanceAmount: toFiniteNumber(a.max_finance_amount),
        initMargin: toFiniteNumber(a.init_margin),
        maintenanceMargin: toFiniteNumber(a.maintenance_margin),
        marginCall: toFiniteNumber(a.margin_call),
        riskLevel: toText(a.risk_level),
        cashInfos: (Array.isArray(a.cash_infos) ? a.cash_infos : []).map((c) => ({
          currency: toCode(c?.currency),
          availableCash: toFiniteNumber(c?.available_cash),
          frozenCash: toFiniteNumber(c?.frozen_cash),
          settlingCash: toFiniteNumber(c?.settling_cash),
          withdrawCash: toFiniteNumber(c?.withdraw_cash),
        })),
      };
    })
    .filter((a): a is AccountAssets => a !== undefined);
}

/** Map the raw `cash-flow` command body into neutral ledger records. */
export function normalizeCashFlow(raw: unknown): CashFlowRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): CashFlowRecord | undefined => {
      const r = entry as RawCashFlowRecord | undefined;
      if (!r || typeof r !== 'object') return undefined;
      return {
        timestamp: toEpochSeconds(r.time),
        currency: toCode(r.currency),
        amount: toFiniteNumber(r.balance),
        businessType: toText(r.business_type),
        flowName: toText(r.flow_name),
        description: toText(r.description),
        symbol: toText(r.symbol),
      };
    })
    .filter((r): r is CashFlowRecord => r !== undefined);
}

// ── Failure classification (spec §19) ──────────────────────────────────────

const USER_SAFE_MESSAGES: Record<PortfolioFailure['kind'], string> = {
  'not-connected': 'LongBridge is not connected. Install or configure the CLI and try again.',
  'no-account-permission': 'This LongBridge account does not grant portfolio access. Reconnect or check permissions.',
  empty: 'No portfolio data yet.',
  partial: 'Account totals loaded, but holdings could not be read.',
  'provider-error': 'LongBridge could not return portfolio data.',
  'parse-error': 'Portfolio data could not be read in the expected format.',
  timeout: 'LongBridge took too long to respond.',
};

/** Trim any raw vendor output that might have leaked into a message. */
function userSafeMessage(message: unknown): string {
  const text = typeof message === 'string' ? message.trim() : '';
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/**
 * Classify a thrown error (LongBridge CLI error, parse error, or generic) into
 * a `PortfolioFailure` with a user-safe message. The raw vendor output is
 * deliberately dropped from `message` (it only survives in `LongBridgeError.debug`).
 */
export function classifyPortfolioFailure(error: unknown): PortfolioFailure {
  if (isLongBridgeError(error)) {
    const kind = kindFromCode(error.code);
    return { kind, message: USER_SAFE_MESSAGES[kind] };
  }
  if (error instanceof Error) {
    const text = userSafeMessage(error.message);
    return { kind: 'provider-error', message: text || USER_SAFE_MESSAGES['provider-error'] };
  }
  return { kind: 'provider-error', message: USER_SAFE_MESSAGES['provider-error'] };
}

function kindFromCode(code: string): PortfolioFailure['kind'] {
  switch (code) {
    case 'LONGBRIDGE_NOT_INSTALLED':
      return 'not-connected';
    case 'LONGBRIDGE_NOT_AUTHED':
      return 'no-account-permission';
    case 'LONGBRIDGE_TIMEOUT':
      return 'timeout';
    case 'LONGBRIDGE_PARSE_FAILURE':
      return 'parse-error';
    default:
      return 'provider-error';
  }
}

/** True when a snapshot looks like it has totals but zero holdings (partial). */
export function isPartialSnapshot(snapshot: PortfolioSnapshot): boolean {
  const hasTotals =
    (snapshot.totalAssets ?? 0) > 0 ||
    (snapshot.marketValue ?? 0) > 0 ||
    snapshot.accounts.some((a) => (a.netAssets ?? 0) > 0 || (a.marketValue ?? 0) > 0);
  return snapshot.holdings.length === 0 && hasTotals;
}

/** True when a snapshot is entirely empty (no holdings and no positive assets). */
export function isEmptySnapshot(snapshot: PortfolioSnapshot): boolean {
  const hasTotals =
    (snapshot.totalAssets ?? 0) > 0 ||
    (snapshot.marketValue ?? 0) > 0 ||
    snapshot.accounts.some((a) => (a.netAssets ?? 0) > 0 || (a.marketValue ?? 0) > 0);
  return snapshot.holdings.length === 0 && !hasTotals;
}

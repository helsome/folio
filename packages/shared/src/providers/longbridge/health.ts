import type { ProviderHealth, ProviderPermission } from '@finagent/core';
import { executeLongBridge } from '@finagent/longbridge-tools';
import { isRecord } from '../../guards.ts';

/**
 * Longbridge connection-health module (spec §8).
 *
 * `status()` is the cheap lifecycle probe both the financial-data and
 * broker-account providers delegate to. It detects CLI presence, then reads
 * `longbridge auth status --format json` to derive connection state,
 * account identity, region, and per-market entitlements. Raw vendor output
 * never reaches a `ProviderHealth.message` — every message is user-safe.
 */

/** Injected command runner (defaults to the longbridge-tools executor). */
export interface LongbridgeExecOptions {
  timeout?: number;
}
export type LongbridgeExec = (
  args: string[],
  options?: LongbridgeExecOptions
) => Promise<string>;

/** Defensively-parsed `longbridge auth status --format json` payload. */
export interface AuthStatusPayload {
  account?: Record<string, unknown>;
  token?: Record<string, unknown>;
}

export function parseAuthStatus(output: string): AuthStatusPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  return {
    account: isRecord(parsed.account) ? parsed.account : undefined,
    token: isRecord(parsed.token) ? parsed.token : undefined,
  };
}

/** Read a string field off a defensive record. */
export function stringField(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

interface ExecLikeError extends Error {
  code?: string;
}

/** True when the CLI binary is missing (ENOENT / not-on-PATH). */
export function isNotInstalledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as ExecLikeError).code;
  if (code === 'ENOENT') return true;
  const message = error.message.toLowerCase();
  return message.includes('enoent') || message.includes('not installed') || message.includes('not on path');
}

// ── quote_level → permissions ──────────────────────────────────────────────

const MARKET_PREFIXES: readonly { prefix: string; market: string; name: string }[] = [
  { prefix: 'SH', market: 'CN', name: 'China A-shares' },
  { prefix: 'SZ', market: 'CN', name: 'China A-shares' },
  { prefix: 'HK', market: 'HK', name: 'Hong Kong' },
  { prefix: 'US', market: 'US', name: 'United States' },
  { prefix: 'SG', market: 'SG', name: 'Singapore' },
];

export interface ParsedQuoteLevel {
  permissions: ProviderPermission[];
  /** True when at least one known market is delayed-only. */
  delayedOnly: boolean;
}

export interface ParsedQuoteLevel {
  permissions: ProviderPermission[];
  /** True when at least one known market is delayed-only. */
  delayedOnly: boolean;
}

/**
 * Parse the `quote_level` entitlement string into `ProviderPermission[]`.
 *
 * Well-known prefixes map to markets (`SH*`/`SZ*` → `CN`, `HK*` → `HK`,
 * `US*` → `US`, `SG*` → `SG`); `Delay`/`LV0` is marked as delayed-but-granted;
 * unknown prefixes pass through as `granted: false` with the raw label
 * (never fabricated). `delayedOnly` drives `permission-limited`.
 */
export function parseQuoteLevel(quoteLevel: string | undefined): ParsedQuoteLevel {
  if (!quoteLevel) return { permissions: [], delayedOnly: false };

  const markets: Record<string, { name: string; realtime: boolean }> = {};
  const unknown: ProviderPermission[] = [];

  for (const rawEntry of quoteLevel.split(';')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const colon = entry.indexOf(':');
    if (colon <= 0) continue;
    const prefix = entry.slice(0, colon).trim();
    const segments = entry
      .slice(colon + 1)
      .split('|')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const level = segments[segments.length - 1] ?? '';

    const known = MARKET_PREFIXES.find((candidate) => prefix.startsWith(candidate.prefix));
    if (!known) {
      unknown.push({ id: prefix, label: prefix, granted: false });
      continue;
    }

    const realtime = level !== '' && level !== 'Delay' && level !== 'LV0';
    const current = markets[known.market];
    if (!current) {
      markets[known.market] = { name: known.name, realtime };
    } else if (!current.realtime && realtime) {
      current.realtime = true;
    }
  }

  const permissions: ProviderPermission[] = Object.entries(markets).map(([market, info]) => ({
    id: market,
    label: info.realtime ? info.name : `${info.name} (delayed)`,
    granted: true,
  }));

  const delayedOnly = Object.values(markets).some((info) => !info.realtime);
  return { permissions: [...permissions, ...unknown], delayedOnly };
}

/** Best-effort region inference from the account's `quote_level`. */
export function inferRegion(account: Record<string, unknown> | undefined): string | undefined {
  const quoteLevel = stringField(account, 'quote_level');
  if (!quoteLevel) return undefined;
  // Mainland (CN) market entitlements are only present on CN-region accounts.
  if (/SH[A-Z0-9]*:[^;]*Mainland|SZ[A-Z0-9]*:[^;]*Mainland/.test(quoteLevel)) {
    return 'CN';
  }
  return undefined;
}

function accountLabel(account: Record<string, unknown> | undefined): string | undefined {
  const name = stringField(account, 'name');
  if (name) return name;
  const accountNo = account?.account_no;
  return accountNo === undefined || accountNo === '' ? undefined : String(accountNo);
}

/** Pure mapping of `longbridge auth status` stdout → `ProviderHealth`. */
export function healthFromAuthStatus(output: string, latencyMs?: number): ProviderHealth {
  const lastCheck = Date.now();
  const json = parseAuthStatus(output);
  const token = json?.token;
  const account = json?.account;
  const tokenStatus = stringField(token, 'status');

  const label = accountLabel(account);
  const region = inferRegion(account);

  if (!token || !tokenStatus) {
    return {
      status: 'not-connected',
      lastCheck,
      latencyMs,
      message: 'Longbridge is not connected.',
    };
  }
  if (tokenStatus !== 'valid') {
    return {
      status: 'expired',
      lastCheck,
      latencyMs,
      account: label,
      region,
      message: 'Longbridge session expired. Reconnect to continue.',
    };
  }

  const parsed = parseQuoteLevel(stringField(account, 'quote_level'));
  return {
    status: parsed.delayedOnly ? 'permission-limited' : 'connected',
    lastCheck,
    latencyMs,
    account: label,
    region,
    permissions: parsed.permissions,
    message: parsed.delayedOnly
      ? 'Connected, with delayed-only market data on some markets.'
      : undefined,
  };
}

// ── Cached probe ───────────────────────────────────────────────────────────

export interface LongbridgeHealthProbeOptions {
  exec?: LongbridgeExec;
  /** Health cache TTL; defaults to 15s (spec §8). */
  cacheTtlMs?: number;
}

export class LongbridgeHealthProbe {
  private readonly exec: LongbridgeExec;
  private readonly cacheTtlMs: number;
  private cached: { health: ProviderHealth; at: number } | undefined;

  constructor(options: LongbridgeHealthProbeOptions = {}) {
    this.exec = options.exec ?? executeLongBridge;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
  }

  async status(): Promise<ProviderHealth> {
    if (this.cached && Date.now() - this.cached.at < this.cacheTtlMs) {
      return this.cached.health;
    }
    const health = await this.probe();
    this.cached = { health, at: Date.now() };
    return health;
  }

  /** Invalidate the cache (call after connect/disconnect). */
  clear(): void {
    this.cached = undefined;
  }

  private async probe(): Promise<ProviderHealth> {
    const startedAt = Date.now();

    try {
      await this.exec(['--version'], { timeout: 5000 });
    } catch (error) {
      if (isNotInstalledError(error)) {
        return {
          status: 'not-installed',
          lastCheck: Date.now(),
          message: 'Longbridge CLI is not installed.',
        };
      }
    }

    try {
      const output = await this.exec(['auth', 'status', '--format', 'json'], { timeout: 10_000 });
      return healthFromAuthStatus(output, Date.now() - startedAt);
    } catch {
      return {
        status: 'error',
        lastCheck: Date.now(),
        message: 'Could not read Longbridge connection status.',
      };
    }
  }
}

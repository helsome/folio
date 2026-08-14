import type {
  ApiResult,
  FinancialProviderStatus,
  ProviderCoverage,
  ProviderHealth,
  ProviderPermission,
} from '@finagent/core';
import type { FinagentClient } from '../client';
import { unwrapIpcResult } from './unwrap';

/**
 * Renderer-facing mirror of the Connections IPC contract (batch context).
 *
 * The main process owns the canonical shapes and channels; these types keep
 * the renderer from importing `@finagent/shared`. The Lead wires
 * `connections:*` + `health:check` into the preload/client — until then every
 * loader degrades to an empty/null result and every action reports a
 * `CHANNEL_UNAVAILABLE` error, so the UI never crashes before wiring.
 */

export type ConnectionKind = 'financial-data' | 'broker-account';

export interface ConnectionError {
  code: string;
  message: string;
}

export interface ConnectionEntry {
  providerId: string;
  kind: ConnectionKind;
  name: string;
  status: FinancialProviderStatus;
  health: ProviderHealth | null;
  coverage: ProviderCoverage | null;
  configurable: boolean;
  configured: boolean;
  hasAccount: boolean;
  accountLabel: string | null;
  error: ConnectionError | null;
}

export interface ConnectResult {
  status: 'connecting' | 'connected';
  verificationUrl?: string;
}

export interface HealthCheckItem {
  ok: boolean;
  detail: string | null;
  error: ConnectionError | null;
}

export interface HealthCheckReport {
  ai: HealthCheckItem;
  marketData: HealthCheckItem;
  skills: HealthCheckItem;
  agentRuntime: HealthCheckItem;
}

/** The connections channel surface (wired by the Lead at integration). */
export interface ConnectionsChannel {
  list: () => Promise<ApiResult<ConnectionEntry[]>>;
  connect: (providerId: string) => Promise<ApiResult<ConnectResult>>;
  cancelConnect: (providerId: string) => Promise<ApiResult<void>>;
  disconnect: (providerId: string) => Promise<ApiResult<ConnectionEntry | null>>;
  test: (providerId: string) => Promise<ApiResult<ProviderHealth>>;
  setConfig: (providerId: string, config: { apiKey?: string }) => Promise<ApiResult<ConnectionEntry>>;
  coverage: () => Promise<ApiResult<ProviderCoverage[]>>;
  onChanged: (callback: (entries: ConnectionEntry[]) => void) => () => void;
}

export interface HealthChannel {
  check: () => Promise<ApiResult<HealthCheckReport>>;
}

/** A failed action result: the user-safe error to surface, never silent. */
export interface ConnectionActionResult<T> {
  ok: boolean;
  data: T | null;
  error: ConnectionError | null;
}

const UNAVAILABLE: ConnectionError = {
  code: 'CHANNEL_UNAVAILABLE',
  message: 'Connections are unavailable in this build.',
};

const IPC_FAILED: ConnectionError = {
  code: 'CONNECTION_IPC_FAILED',
  message: 'The connection request failed. Try again.',
};

function asError(error: unknown): ConnectionError {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return { code: error.code, message: error.message };
  }
  return IPC_FAILED;
}

/** List connection entries; returns [] when the channel is absent or fails. */
export async function loadConnections(client: FinagentClient): Promise<ConnectionEntry[]> {
  const list = client.connections?.list;
  if (typeof list !== 'function') return [];
  try {
    return unwrapIpcResult<ConnectionEntry[]>(await list()) ?? [];
  } catch {
    return [];
  }
}

/** Coverage matrix across providers; returns [] when absent or fails. */
export async function loadCoverage(client: FinagentClient): Promise<ProviderCoverage[]> {
  const coverage = client.connections?.coverage;
  if (typeof coverage !== 'function') return [];
  try {
    return unwrapIpcResult<ProviderCoverage[]>(await coverage()) ?? [];
  } catch {
    return [];
  }
}

/** Aggregate health report; returns null when absent or fails. */
export async function loadHealthCheck(client: FinagentClient): Promise<HealthCheckReport | null> {
  const check = client.health?.check;
  if (typeof check !== 'function') return null;
  try {
    return unwrapIpcResult<HealthCheckReport>(await check());
  } catch {
    return null;
  }
}

/** Subscribe to connection changes; returns an unsubscribe (no-op when absent). */
export function subscribeConnections(
  client: FinagentClient,
  callback: (entries: ConnectionEntry[]) => void
): () => void {
  const onChanged = client.connections?.onChanged;
  if (typeof onChanged !== 'function') return () => undefined;
  try {
    return onChanged(callback);
  } catch {
    return () => undefined;
  }
}

/** Begin a connection (device flow for longbridge, config validation for BYOK). */
export async function connectProvider(
  client: FinagentClient,
  providerId: string
): Promise<ConnectionActionResult<ConnectResult>> {
  const connect = client.connections?.connect;
  if (typeof connect !== 'function') return { ok: false, data: null, error: UNAVAILABLE };
  try {
    const result = await connect(providerId);
    if (result.ok) return { ok: true, data: result.data, error: null };
    return { ok: false, data: null, error: result.error };
  } catch (error) {
    return { ok: false, data: null, error: asError(error) };
  }
}

/** Disconnect a provider. */
export async function disconnectProvider(
  client: FinagentClient,
  providerId: string
): Promise<ConnectionActionResult<ConnectionEntry | null>> {
  const disconnect = client.connections?.disconnect;
  if (typeof disconnect !== 'function') return { ok: false, data: null, error: UNAVAILABLE };
  try {
    const result = await disconnect(providerId);
    if (result.ok) return { ok: true, data: result.data, error: null };
    return { ok: false, data: null, error: result.error };
  } catch (error) {
    return { ok: false, data: null, error: asError(error) };
  }
}

/** On-demand health check ("Test Connection"). */
export async function testProvider(
  client: FinagentClient,
  providerId: string
): Promise<ConnectionActionResult<ProviderHealth>> {
  const test = client.connections?.test;
  if (typeof test !== 'function') return { ok: false, data: null, error: UNAVAILABLE };
  try {
    const result = await test(providerId);
    if (result.ok) return { ok: true, data: result.data, error: null };
    return { ok: false, data: null, error: result.error };
  } catch (error) {
    return { ok: false, data: null, error: asError(error) };
  }
}

/** Persist BYOK provider config (e.g. the Massive API key). */
export async function setProviderConfig(
  client: FinagentClient,
  providerId: string,
  config: { apiKey?: string }
): Promise<ConnectionActionResult<ConnectionEntry>> {
  const setConfig = client.connections?.setConfig;
  if (typeof setConfig !== 'function') return { ok: false, data: null, error: UNAVAILABLE };
  try {
    const result = await setConfig(providerId, config);
    if (result.ok) return { ok: true, data: result.data, error: null };
    return { ok: false, data: null, error: result.error };
  } catch (error) {
    return { ok: false, data: null, error: asError(error) };
  }
}

/** Whether the client exposes the optional `openExternal` channel. */
export function hasOpenExternal(client: FinagentClient): boolean {
  return typeof client.openExternal === 'function';
}

/**
 * Open an external URL via the optional `openExternal` channel when present.
 * Returns false when the channel is absent — callers fall back to a plain
 * anchor (`target="_blank"`). Do NOT invent IPC in the preload.
 */
export async function openExternalUrl(client: FinagentClient, url: string): Promise<boolean> {
  const openExternal = client.openExternal;
  if (typeof openExternal !== 'function') return false;
  try {
    return (await openExternal(url)).ok;
  } catch {
    return false;
  }
}

// ── Capability matrix (spec §7) ─────────────────────────────────────────────

export type CapabilityFamily = 'Quote' | 'KLine' | 'News' | 'Financials' | 'Portfolio';

export const CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  'Quote',
  'KLine',
  'News',
  'Financials',
  'Portfolio',
] as const;

const FAMILY_CAPABILITIES: Record<CapabilityFamily, readonly string[]> = {
  Quote: ['market.quote'],
  KLine: ['market.kline'],
  News: ['research.news'],
  Financials: [
    'company.profile',
    'company.valuation',
    'company.financials',
    'company.dividends',
    'company.earnings',
    'company.ratings',
  ],
  Portfolio: ['portfolio.summary', 'portfolio.positions', 'portfolio.assets', 'portfolio.cashFlow'],
};

/** Whether a coverage entry serves at least one capability in a family. */
export function familyCovered(coverage: ProviderCoverage | null, family: CapabilityFamily): boolean {
  if (!coverage) return false;
  return FAMILY_CAPABILITIES[family].some((id) => coverage.capabilities.includes(id));
}

/** Human label for a connection lifecycle status (spec §8/§11). */
export function connectionStatusLabel(status: FinancialProviderStatus): string {
  switch (status) {
    case 'not-installed':
      return 'Not installed';
    case 'not-connected':
      return 'Not connected';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'permission-limited':
      return 'Permission limited';
    case 'expired':
      return 'Expired';
    case 'error':
      return 'Error';
  }
}

/**
 * Compact quote-access summary from a health snapshot's permissions, e.g.
 * `US ✓ · HK ✓`. Unknown/missing entitlements are omitted — never fabricated.
 */
export function quoteAccessSummary(permissions: ProviderPermission[] | undefined): string | null {
  if (!permissions || permissions.length === 0) return null;
  const granted = permissions
    .filter((permission) => permission.granted)
    .map((permission) => permission.label || permission.id)
    .filter((label) => label.trim().length > 0);
  if (granted.length === 0) return null;
  return `${granted.map((label) => `${label} ✓`).join(' · ')}`;
}

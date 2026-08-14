import type { ProviderHealth } from '@finagent/core';
import { isRecord } from '../../guards.ts';
import { parseAuthStatus, stringField, type LongbridgeExec } from './health.ts';

/**
 * Main-process Longbridge auth orchestration (docs/longbridge-auth.md).
 *
 * Pure and testable: every command runs through an injected `exec` (short
 * commands) or `spawn` (the long-running device-flow login). The renderer
 * never touches the shell — `openUrl` is wired to `shell.openExternal` by the
 * kernel.
 */

export type LoginOutcome = { status: 'connected' | 'timeout' | 'cancelled' };

export interface SpawnedProcess {
  kill(): void;
}

/** Launch a process; `onStdout` receives stdout chunks as they arrive. */
export type SpawnFn = (args: string[], onStdout: (chunk: string) => void) => SpawnedProcess;

export interface StartLoginOptions {
  exec: LongbridgeExec;
  spawn: SpawnFn;
  openUrl: (uri: string) => void | Promise<void>;
  /** Called as soon as the verification URI is known (before `openUrl`). */
  onVerificationUri?: (uri: string) => void;
  /** Auth-status poll interval; defaults to 3s. */
  pollMs?: number;
  /** Overall device-flow deadline; defaults to 180s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LogoutOptions {
  exec: LongbridgeExec;
}

export interface TestConnectionOptions {
  exec: LongbridgeExec;
}

const VERIFICATION_URI_KEYS = ['verification_uri', 'verification_uri_complete', 'verification_url', 'url'];

function tryParseFirstObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract the device-flow `verification_uri` from `auth login` stdout. The
 * command prints JSON, but shape may drift — parse defensively, checking the
 * well-known URL keys first, then falling back to a raw http(s) URL.
 */
export function extractVerificationUri(text: string): string | undefined {
  const json = tryParseFirstObject(text);
  if (isRecord(json)) {
    for (const key of VERIFICATION_URI_KEYS) {
      const value = json[key];
      if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
    }
  }
  const match = text.match(/https?:\/\/[^\s"'`]+/);
  return match ? match[0] : undefined;
}

async function pollTokenStatus(exec: LongbridgeExec): Promise<string | undefined> {
  try {
    const output = await exec(['auth', 'status', '--format', 'json'], { timeout: 10_000 });
    const json = parseAuthStatus(output);
    const status = json?.token?.status;
    return typeof status === 'string' ? status : undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    resolve();
    return promise;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    resolve();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  return promise;
}

/**
 * Orchestrate the CLI device-authorization flow: launch `longbridge auth
 * login`, open the `verification_uri`, then poll `auth status` until the
 * token is valid, the deadline passes, or the caller cancels.
 */
export async function startLogin(options: StartLoginOptions): Promise<LoginOutcome> {
  const { exec, spawn, openUrl, onVerificationUri, pollMs = 3000, timeoutMs = 180000, signal } = options;

  if (signal?.aborted) return { status: 'cancelled' };

  let accumulated = '';
  let uriOpened = false;

  const child = spawn(['auth', 'login', '--format', 'json'], (chunk) => {
    accumulated += chunk;
    if (uriOpened) return;
    const uri = extractVerificationUri(accumulated);
    if (uri) {
      uriOpened = true;
      onVerificationUri?.(uri);
      void openUrl(uri);
    }
  });

  const startedAt = Date.now();

  try {
    while (true) {
      if (signal?.aborted) return { status: 'cancelled' };
      if (Date.now() - startedAt >= timeoutMs) return { status: 'timeout' };
      if ((await pollTokenStatus(exec)) === 'valid') return { status: 'connected' };
      await sleep(pollMs, signal);
    }
  } finally {
    child.kill();
  }
}

/** Disconnect: clear the stored Longbridge token. */
export async function logout(options: LogoutOptions): Promise<void> {
  await options.exec(['auth', 'logout']);
}

function parseCheckJson(output: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(output);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Run `longbridge check --format json` and map it to a `ProviderHealth`. */
export async function testConnection(options: TestConnectionOptions): Promise<ProviderHealth> {
  const { exec } = options;
  const startedAt = Date.now();
  const lastCheck = Date.now();

  let output: string;
  try {
    output = await exec(['check', '--format', 'json'], { timeout: 15_000 });
  } catch {
    return { status: 'error', lastCheck, message: 'Longbridge connectivity check failed.' };
  }

  const json = parseCheckJson(output);
  const region = stringField(isRecord(json?.region) ? json.region : undefined, 'active');
  const token = stringField(isRecord(json?.session) ? json.session : undefined, 'token');
  const connectivity = isRecord(json?.connectivity) ? json.connectivity : undefined;
  const cnOk = isRecord(connectivity?.cn) && connectivity.cn.ok === true;
  const globalOk = isRecord(connectivity?.global) && connectivity.global.ok === true;
  const latencyMs = Date.now() - startedAt;

  if (token !== 'valid') {
    return {
      status: 'expired',
      lastCheck,
      region,
      latencyMs,
      message: 'Longbridge session is not valid.',
    };
  }
  if (!cnOk && !globalOk) {
    return {
      status: 'error',
      lastCheck,
      region,
      latencyMs,
      message: 'Longbridge could not reach its API servers.',
    };
  }
  return { status: 'connected', lastCheck, region, latencyMs };
}

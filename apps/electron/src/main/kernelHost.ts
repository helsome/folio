import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type {
  AgentEvent,
  ApiResult,
  Message,
  Run,
  SessionMeta,
  ToolDefinition,
} from '@finagent/core';
import { AgentKernel, MarketDataService } from '@finagent/shared';

type IpcSuccess<T> = { ok: true; data: T };
type IpcFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    action?: string;
  };
};

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

interface KlineRequest {
  symbol: string;
  period?: string;
  limit?: number;
}

/**
 * Main-process bridge between the renderer and the agent kernel.
 *
 * Sessions, runs, and agent events live in the kernel; the window only sees
 * the whitelisted IPC surface and the `agent:event` push channel.
 */
export class AgentKernelHost {
  private readonly marketData = new MarketDataService();
  private readonly kernel: AgentKernel;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.kernel = new AgentKernel({
      storageDir: join(app.getPath('userData'), 'store'),
      piSessionDir: join(app.getPath('userData'), 'pi-sessions'),
      provider: readAgentProvider(),
      marketData: this.marketData,
      rpc: {
        requiredEnvKeys: readRequiredLlmEnvKeys(),
      },
    });
  }

  /** Forward kernel events to the window's renderer. */
  attach(window: BrowserWindow): void {
    this.unsubscribe?.();
    this.unsubscribe = this.kernel.runs.subscribe((event: AgentEvent) => {
      if (!window.isDestroyed()) {
        window.webContents.send('agent:event', event);
      }
    });
  }

  async hydrate(): Promise<{ sessions: SessionMeta[] }> {
    return { sessions: await this.kernel.sessions.listSessions() };
  }

  async createSession(title: unknown): Promise<SessionMeta> {
    return this.kernel.sessions.createSession(typeof title === 'string' ? title : undefined);
  }

  async deleteSession(sessionId: unknown): Promise<void> {
    await this.kernel.sessions.deleteSession(requireString(sessionId, 'sessionId'));
  }

  async getMessages(sessionId: unknown): Promise<Message[]> {
    return this.kernel.sessions.listMessages(requireString(sessionId, 'sessionId'));
  }

  async listRuns(sessionId: unknown): Promise<Run[]> {
    return this.kernel.sessions.listRuns(requireString(sessionId, 'sessionId'));
  }

  async startRun(input: unknown): Promise<Run> {
    const request = requireObject(input);
    return this.kernel.runs.startRun(
      requireString(request.sessionId, 'sessionId'),
      requireString(request.content, 'content')
    );
  }

  async cancelRun(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.kernel.runs.cancelRun(
      requireString(request.sessionId, 'sessionId'),
      requireString(request.runId, 'runId')
    );
  }

  getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return this.kernel.getTools();
  }

  getQuote(symbol: unknown) {
    return this.marketData.getQuote(requireString(symbol, 'symbol').toUpperCase());
  }

  getKline(input: unknown) {
    const request = requireObject(input);
    const payload: KlineRequest = {
      symbol: requireString(request.symbol, 'symbol').toUpperCase(),
    };

    if (typeof request.period === 'string') {
      payload.period = request.period;
    }

    if (typeof request.limit === 'number' && Number.isFinite(request.limit)) {
      payload.limit = request.limit;
    }

    return this.marketData.getKline({
      symbol: payload.symbol,
      period: payload.period as '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | undefined,
      limit: payload.limit,
    });
  }

  getPortfolio() {
    return this.marketData.getPortfolio();
  }

  async getLongBridgeStatus() {
    const status = await this.marketData.getLongBridgeStatus();
    const message = status.available
      ? 'LongBridge CLI is installed and authenticated.'
      : status.error?.message ?? 'LongBridge CLI is not ready.';
    const action = status.available
      ? undefined
      : getLongBridgeStatusAction(status.status);

    return {
      ...status,
      authenticated: status.authed,
      message,
      action,
      code: status.error?.code,
    };
  }

  async loadAlerts() {
    try {
      const contents = await readFile(getAlertsPath(), 'utf8');
      return JSON.parse(contents) as unknown;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async saveAlerts(alerts: unknown) {
    await mkdir(dirname(getAlertsPath()), { recursive: true });
    await writeFile(getAlertsPath(), JSON.stringify(alerts, null, 2), 'utf8');
    return alerts;
  }

  async dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.kernel.dispose();
  }
}

function getLongBridgeStatusAction(status: string) {
  if (status === 'not_installed') {
    return 'Install LongBridge CLI, then run longbridge auth login.';
  }
  if (status === 'not_authed') {
    return 'Run longbridge auth login and retry.';
  }
  if (status === 'rate_limited') {
    return 'Wait a moment before retrying LongBridge requests.';
  }
  if (status === 'timeout') {
    return 'Check your network connection and retry.';
  }
  return 'Check LongBridge CLI status and retry.';
}

export function toIpcError(error: unknown): IpcFailure['error'] {
  if (isCodeError(error)) {
    return {
      code: error.code,
      message: error.message,
      action: error.action,
    };
  }

  if (error instanceof Error) {
    if (error.message.includes('INVALID_SYMBOL')) {
      return {
        code: 'INVALID_SYMBOL',
        message: error.message,
        action: 'Use a symbol like AAPL.US, 0700.HK, or 600519.SH.',
      };
    }

    if (error.message.includes('ENOENT')) {
      return {
        code: 'LONGBRIDGE_NOT_INSTALLED',
        message: 'LongBridge CLI is not installed or not on PATH.',
        action: 'Install LongBridge CLI before running market queries.',
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
  };
}

export async function toIpcResult<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const result = await operation();
    if (isApiResult<T>(result)) {
      return result;
    }
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}

function readAgentProvider() {
  const provider = process.env.FINAGENT_AGENT_PROVIDER;
  if (provider === 'local' || provider === 'pi-runtime') return provider;
  return undefined;
}

function readRequiredLlmEnvKeys() {
  if (process.env.FINAGENT_REQUIRE_LLM_ENV === '0') return [];
  const value = process.env.FINAGENT_REQUIRED_LLM_ENV;
  if (value) {
    return value.split(',').map((key) => key.trim()).filter(Boolean);
  }
  return ['ANTHROPIC_API_KEY'];
}

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'ok' in value &&
      typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createCodeError('INVALID_ARGUMENT', `${field} is required.`);
  }
  return value.trim();
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createCodeError('INVALID_ARGUMENT', 'Expected an object payload.');
  }
  return value as Record<string, unknown>;
}

function getAlertsPath() {
  return join(app.getPath('userData'), 'alerts.json');
}

function createCodeError(code: string, message: string, action?: string) {
  const error = new Error(message) as Error & { code: string; action?: string };
  error.code = code;
  error.action = action;
  return error;
}

function isCodeError(error: unknown): error is Error & { code: string; action?: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

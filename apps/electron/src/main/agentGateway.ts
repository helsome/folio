import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { LocalFinanceAgentBackend, MarketDataService } from '@finagent/shared';

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

export class AgentGateway {
  private readonly marketData = new MarketDataService();
  private readonly backend = new LocalFinanceAgentBackend({
    marketData: this.marketData,
  });

  getTools() {
    return this.backend.getTools();
  }

  async send(message: unknown) {
    return this.backend.send({
      sessionId: extractSessionId(message),
      content: extractMessageText(message),
    });
  }

  getQuote(symbol: unknown) {
    return this.marketData.getQuote(requireString(symbol, 'symbol'));
  }

  getKline(input: unknown) {
    const request = requireObject(input);
    const payload: KlineRequest = {
      symbol: requireString(request.symbol, 'symbol'),
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
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}

function extractMessageText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    for (const key of ['text', 'message', 'content', 'query', 'prompt']) {
      if (typeof record[key] === 'string') {
        return record[key];
      }
    }
  }

  return '';
}

function extractSessionId(message: unknown): string | undefined {
  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    if (typeof record.sessionId === 'string') {
      return record.sessionId;
    }
  }
  return undefined;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createCodeError('INVALID_ARGUMENT', `${field} is required.`);
  }
  return value.trim().toUpperCase();
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

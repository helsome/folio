import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { tools, type Tool } from '@finagent/pi-extension';
import {
  getKline,
  getLongBridgeStatus,
  getPortfolio,
  getQuote,
} from '@finagent/longbridge-tools';

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

type ToolName = 'get_quote' | 'get_portfolio' | 'get_kline' | 'get_intraday';
type ToolResult = Awaited<ReturnType<Tool['execute']>>;

interface AgentReply {
  content: string;
  tool?: ToolName;
  toolName?: ToolName;
  result?: ToolResult;
  details?: ToolResult;
}

interface KlineRequest {
  symbol: string;
  period?: string;
  limit?: number;
}

const SUPPORTED_TOOL_NAMES: ToolName[] = [
  'get_quote',
  'get_portfolio',
  'get_kline',
  'get_intraday',
];

const SYMBOL_REGEX = /\b[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)\b/i;
const FRIENDLY_UNSUPPORTED =
  '当前 MVP 支持 quote/行情/价格、K-line/K线 和 portfolio/持仓/组合 查询。请带上标的代码，例如 AAPL.US 或 0700.HK。';

export class AgentGateway {
  private readonly registry = new Map<ToolName, Tool>();

  constructor() {
    for (const tool of tools) {
      if (SUPPORTED_TOOL_NAMES.includes(tool.name as ToolName)) {
        this.registry.set(tool.name as ToolName, tool);
      }
    }
  }

  getTools() {
    return SUPPORTED_TOOL_NAMES.map((name) => this.registry.get(name))
      .filter((tool): tool is Tool => Boolean(tool))
      .map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  async send(message: unknown): Promise<AgentReply> {
    const text = extractMessageText(message);
    const symbol = extractSymbol(text);
    const normalized = text.toLowerCase();

    if (hasAny(text, ['portfolio', '持仓', '组合'])) {
      const result = await this.callTool('get_portfolio', {});
      return toAgentReply('get_portfolio', result);
    }

    if (symbol && (normalized.includes('kline') || text.includes('K线') || text.includes('k线'))) {
      const result = await this.callTool('get_kline', { symbol });
      return toAgentReply('get_kline', result);
    }

    if (symbol && hasAny(text, ['quote', '行情', '价格'])) {
      const result = await this.callTool('get_quote', { symbol });
      return toAgentReply('get_quote', result);
    }

    return { content: FRIENDLY_UNSUPPORTED };
  }

  getQuote(symbol: unknown) {
    return getQuote(requireString(symbol, 'symbol'));
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

    return getKline({
      symbol: payload.symbol,
      period: payload.period as '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | undefined,
      limit: payload.limit,
    });
  }

  getPortfolio() {
    return getPortfolio();
  }

  async getLongBridgeStatus() {
    const status = await getLongBridgeStatus();
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

  private async callTool(name: ToolName, params: Record<string, unknown>) {
    const tool = this.registry.get(name);
    if (!tool) {
      throw createCodeError('TOOL_NOT_FOUND', `Tool is not registered: ${name}`);
    }

    return tool.execute(`${name}-${Date.now()}`, params, new AbortController().signal);
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

function extractSymbol(text: string) {
  return text.match(SYMBOL_REGEX)?.[0].toUpperCase();
}

function hasAny(text: string, needles: string[]) {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function extractToolText(result: ToolResult) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

function toAgentReply(toolName: ToolName, result: ToolResult): AgentReply {
  return {
    content: extractToolText(result),
    tool: toolName,
    toolName,
    result,
    details: result,
  };
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

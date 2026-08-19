// Unified trace redaction + privacy levels (spec §56-60).
//
// Rules:
//   - ALWAYS: credentials and credential-shaped strings are redacted, no matter
//     the privacy level (apiKey/token/authorization/cookie/secret/password,
//     LangSmith lsv2_ keys, base64 blobs, JWT, Bearer…). We never rely on the
//     remote side to redact (spec §59).
//   - minimal: no prompt, no answer, no tool args/results — names, status,
//     durations and counts only.
//   - standard: prompt/answer/tool args allowed after redaction; portfolio tool
//     results are reduced to a schema summary (tool name, success/error,
//     latency) — never raw holdings/positions/cash/account ids (spec §60).
//   - full: complete trace, still credential-redacted. Explicit opt-in only.
import type { PrivacyLevel, ToolCallRecord } from '@finagent/core';
import { redact as redactText } from '../diagnostics/redact.ts';

const REDACTED = '[REDACTED]';

/** Field names treated as credential-bearing and always redacted. */
const SECRET_FIELD_NAMES: Record<string, true> = {
  apikey: true,
  api_key: true,
  'x-api-key': true,
  authorization: true,
  cookie: true,
  cookies: true,
  secret: true,
  password: true,
  passphrase: true,
  token: true,
  access_token: true,
  refresh_token: true,
  id_token: true,
  credential: true,
  credentials: true,
  client_secret: true,
  privatekey: true,
  private_key: true,
  auth: true,
};

/**
 * Portfolio-sensitive tool names. Full payloads never leave the machine below
 * `full` (spec §60). Matches capability ids (portfolio.*), legacy ids
 * (portfolio-*), and the agent-facing tool names (get_portfolio,
 * get_positions, get_assets, get_cash_flow) that carry holdings/cash data.
 */
const PORTFOLIO_TOOL_PATTERNS = [
  /^portfolio\./,
  /^portfolio-/,
  /(portfolio|position|holding|cash.?flow|assets?)/,
];

function isPortfolioToolName(name: string): boolean {
  return PORTFOLIO_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

export { isPortfolioToolName };

export interface RedactionResult<T> {
  redacted: T;
  /** Fields that were replaced (for diagnostics, never the values). */
  redactedFieldPaths: string[];
  /** True when any portfolio payload was downgraded to a summary. */
  portfolioDowngraded: boolean;
}

function isSecretField(path: string): boolean {
  const leaf = path.split('.').pop()?.toLowerCase() ?? '';
  if (SECRET_FIELD_NAMES[leaf]) return true;
  // Generic credential-like suffixes: apiKey, apiKeyV2, signingKey, accessToken,
  // password (history-safe: payload fields that end in these are credential-ish).
  return /(key|secret|token|password|passwd|bearer)$/.test(leaf) || leaf.startsWith('api_');
}

export class EvaluationRedactor {
  private readonly privacyLevel: PrivacyLevel;

  constructor(privacyLevel: PrivacyLevel) {
    this.privacyLevel = privacyLevel;
  }

  /**
   * Deep-redact an arbitrary JSON value; returns a structurally safe copy.
   * Pass the owning tool name so portfolio payloads are downgraded to schema
   * summaries below `full` (spec §60).
   */
  redactValue(value: unknown, options?: { toolName?: string }): RedactionResult<unknown> {
    const paths: string[] = [];
    let portfolioDowngraded = false;
    const isToolResult = options?.toolName !== undefined && isPortfolioToolName(options.toolName);
    if (isToolResult && this.privacyLevel !== 'full') {
      return { redacted: portfolioSummary(value), redactedFieldPaths: ['<portfolio>'], portfolioDowngraded: true };
    }
    const walk = (node: unknown, path: string): unknown => {
      if (typeof node === 'string') {
        if (isSecretField(path)) {
          paths.push(path);
          return REDACTED;
        }
        const cleaned = redactText(node);
        if (cleaned !== node) paths.push(path);
        return cleaned;
      }
      if (typeof node !== 'object' || node === null) return node;
      if (Array.isArray(node)) {
        return node.map((item, index) => walk(item, `${path}[${index}]`));
      }
      const record = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSecretField(childPath)) {
          paths.push(childPath);
          out[key] = REDACTED;
          continue;
        }
        out[key] = walk(value, childPath);
      }
      return out;
    };
    const redacted = walk(value, '');
    return { redacted, redactedFieldPaths: paths, portfolioDowngraded };
  }

  /** Redact an assistant answer string for the current privacy level. */
  redactAnswer(answer: string | undefined): string | undefined {
    if (answer === undefined) return undefined;
    if (this.privacyLevel === 'minimal') return undefined;
    return redactText(answer);
  }

  /** Redact a tool call: args per privacy, result per privacy + portfolio rule. */
  redactToolCall(toolCall: ToolCallRecord): ToolCallRecord {
    const portfolioTool = isPortfolioToolName(toolCall.toolName);
    const redacted: ToolCallRecord = {
      id: toolCall.id,
      toolName: toolCall.toolName,
      args: {},
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      status: toolCall.status,
      // Errors may embed credential-shaped text even at minimal (spec §105).
      error: toolCall.error
        ? { ...toolCall.error, message: redactText(toolCall.error.message) }
        : undefined,
    };
    if (this.privacyLevel === 'minimal') {
      return redacted; // names + status + timings only
    }
    if (this.privacyLevel === 'standard') {
      redacted.args = this.redactValue(toolCall.args, { toolName: toolCall.toolName }).redacted as Record<
        string,
        unknown
      >;
      redacted.result = portfolioTool
        ? portfolioSummary(toolCall.result)
        : this.redactValue(toolCall.result, { toolName: toolCall.toolName }).redacted;
      return redacted;
    }
    // full: complete payload; credentials still redacted; trace preserved.
    redacted.args = this.redactValue(toolCall.args).redacted as Record<string, unknown>;
    redacted.result = this.redactValue(toolCall.result).redacted;
    if (Array.isArray(toolCall.trace)) {
      redacted.trace = toolCall.trace.map((entry) => ({
        ...entry,
        message: entry.message !== undefined ? redactText(entry.message) : undefined,
        data: this.redactValue(entry.data).redacted,
      }));
    }
    return redacted;
  }
}

/** Schema summary of a portfolio payload: shape + counts, never values (spec §60). */
function portfolioSummary(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return { type: 'text', length: value.length, redacted: true };
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, redacted: true };
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>);
    return { type: 'object', keys: keys.slice(0, 32), redacted: true };
  }
  return { type: typeof value, redacted: true };
}


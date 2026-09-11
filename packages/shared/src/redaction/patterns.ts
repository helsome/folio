/**
 * Centralized secret detection patterns (issue #19).
 *
 * Single source of truth for all redaction across logs, diagnostics,
 * telemetry, traces, and eval artifacts. Adding a new secret shape here
 * makes it redacted everywhere automatically.
 */

export const REDACTED = '[REDACTED]';

/**
 * Ordered list of [pattern, replacement] pairs.
 * Order matters: more specific patterns run before more generic ones.
 */
export const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // OpenAI/Anthropic-style keys: sk-…, sk-ant-…, rk-/pk-/ak-…
  [/\b(?:sk-ant-|sk-|rk-|pk-|ak-)[A-Za-z0-9_-]{8,}\b/g, REDACTED],

  // AWS access key ids (20 uppercase alphanumeric chars prefixed with AKIA)
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],

  // Bearer auth headers: keep the scheme, redact the token
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/g, `$1${REDACTED}`],

  // API-key headers / JSON fields: x-api-key, X-Api-Key, apiKey, api_key
  [/(["']?(?:x-api-key|X-Api-Key|api[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}["']?/g, `$1${REDACTED}`],

  // JWTs (header.payload.signature)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],

  // GitHub / common VCS tokens
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{8,}\b/g, REDACTED],

  // LangSmith API keys: lsv2_pt_/lsv2_sk_ prefixes
  [/\blsv2_(?:pt_|sk_)?[A-Za-z0-9]{8,}\b/g, REDACTED],

  // Connection strings (postgres://user:pass@host, mongodb://..., etc.)
  [/(?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^\s:]+:[^\s@]+@/g, `$1://[user]:${REDACTED}@`],

  // Webhook URLs with secret tokens (e.g., hooks.slack.com/services/T.../B.../xxx)
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+/g, `$1${REDACTED}`],

  // URL query parameters that look like secrets (?api_key=..., ?token=...)
  [/([?&](?:api_key|apikey|token|access_token|secret|key)=)[^&\s]+/g, `$1${REDACTED}`],

  // Base64-ish blobs: long runs (≥40 chars) that include an uppercase char
  [/\b(?=[A-Za-z0-9+/]{40,}={0,2})(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}/g, REDACTED],
];

/** Field names treated as credential-bearing (case-insensitive leaf match). */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'apikey',
  'api_key',
  'x-api-key',
  'authorization',
  'cookie',
  'cookies',
  'secret',
  'password',
  'passphrase',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'credential',
  'credentials',
  'client_secret',
  'privatekey',
  'private_key',
  'auth',
]);

/**
 * Check if a field path leaf looks like a secret field.
 * Matches exact names and common suffixes/prefixes.
 */
export function isSecretFieldName(path: string): boolean {
  const leaf = path.split('.').pop()?.toLowerCase() ?? '';
  if (SECRET_FIELD_NAMES.has(leaf)) return true;
  // Generic credential-like suffixes: apiKey, signingKey, accessToken, password
  if (/(key|secret|token|password|passwd|bearer)$/.test(leaf)) return true;
  // Prefix patterns: api_*, app_*
  if (leaf.startsWith('api_') || leaf.startsWith('app_')) return true;
  return false;
}

/** Portfolio-sensitive tool name patterns. */
export const PORTFOLIO_TOOL_PATTERNS: ReadonlyArray<RegExp> = [
  /^portfolio\./,
  /^portfolio-/,
  /(portfolio|position|holding|cash.?flow|assets?)/,
];

/** Check if a tool name carries portfolio/account data. */
export function isPortfolioToolName(name: string): boolean {
  return PORTFOLIO_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Redaction policy documentation.
 * Used in diagnostics bundles and settings UI.
 */
export const REDACTION_POLICY_DOC = [
  'Strips API keys (sk-/rk-/pk-/ak-…), AWS access keys (AKIA…), Bearer and',
  'X-Api-Key/Authorization tokens, JWTs, VCS tokens (gh*/github_pat_),',
  'LangSmith keys (lsv2_pt_/lsv2_sk_…), connection strings, webhook secrets,',
  'URL query secrets, and base64-ish blobs.',
  'Secret field names (apiKey, token, password, cookie…) are always redacted',
  'regardless of value. Portfolio/account data is downgraded to schema summaries',
  'at standard privacy level, and fully redacted at minimal level.',
].join(' ');

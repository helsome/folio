// Single rule source for outbound-data redaction and data minimization
// (issue #19). Every boundary that lets data leave the core runtime — kernel
// logs, the diagnostics bundle, LangSmith/Langfuse payloads, eval artifacts,
// IPC error serialization, report exports — derives its rules from here
// instead of keeping a private regex list.

/** Marker substituted for every redacted secret. */
export const REDACTED = '[REDACTED]';

/**
 * Human-readable summary of the string-level redaction policy. Surfaced in
 * the diagnostics bundle (`redaction.policy`) so support bundles state what
 * was stripped.
 */
export const REDACTION_POLICY =
  'Strips API keys (sk-/rk-/pk-/ak-…), AWS keys (AKIA…), Bearer and Basic auth ' +
  'headers, x-api-key/apiKey fields, JWTs, VCS tokens (gh*/github_pat_/' +
  'glpat-/npm_), cloud & SaaS tokens (lsv2_/xox…/SG./AIza…/ya29.), cookies & ' +
  'session tokens, webhook signatures (whsec_/x-hub-signature), private key ' +
  'PEM blocks, URL userinfo and secret query parameters, connection-string ' +
  'credentials, and base64-ish blobs. Private conversation contents and ' +
  'portfolio details are additionally minimized per privacy level.';

/**
 * Field names treated as credential-bearing: their values are replaced with
 * REDACTED regardless of content shape (spec §56-60).
 */
export const SECRET_FIELD_NAMES: Record<string, true> = {
  apikey: true,
  api_key: true,
  'x-api-key': true,
  apisecret: true,
  api_secret: true,
  secretkey: true,
  secret_key: true,
  authorization: true,
  proxyauthorization: true,
  cookie: true,
  cookies: true,
  'set-cookie': true,
  sessiontoken: true,
  session_token: true,
  secret: true,
  password: true,
  passwd: true,
  passphrase: true,
  token: true,
  accesstoken: true,
  access_token: true,
  refreshtoken: true,
  refresh_token: true,
  id_token: true,
  credential: true,
  credentials: true,
  clientsecret: true,
  client_secret: true,
  privatekey: true,
  private_key: true,
  auth: true,
  webhooksecret: true,
  webhook_secret: true,
  sharedsecret: true,
  signingkey: true,
  signing_key: true,
};

/** Field-name suffixes that mark a field as credential-like. */
const SECRET_FIELD_SUFFIX = /(key|secret|token|password|passwd|bearer|credential)$/;

/**
 * True when a dotted object path points at a credential-bearing field. The
 * leaf segment decides; `apiKeyV2`, `signingKey`, `access_token` all match
 * (history-safe: payload fields that end in these are credential-ish).
 */
export function isSecretField(path: string): boolean {
  const leaf = path.split('.').pop()?.split('[')[0]?.toLowerCase() ?? '';
  if (SECRET_FIELD_NAMES[leaf]) return true;
  return SECRET_FIELD_SUFFIX.test(leaf) || leaf.startsWith('api_');
}

/** Key shapes that may carry account/position/portfolio data (spec §55). */
export const ACCOUNT_LIKE_KEY =
  /(account|position|portfolio|holding|balance|equity|assets|netasset|net_asset|nav)/i;

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

/** Numbers (or numeric-looking strings) are treated as account values. */
export function isNumeric(value: unknown): boolean {
  return (
    typeof value === 'number' || (typeof value === 'string' && NUMERIC_STRING.test(value))
  );
}

/**
 * Default telemetry content policy (issue #19). `full` content tracing is an
 * explicit opt-in; the default (`standard`) never uploads raw user content
 * beyond redacted prompt/answer/tool metadata, and `minimal` ships names,
 * statuses, durations and counts only. The long-form policy lives in
 * docs/privacy-redaction.md.
 */
export const DEFAULT_TELEMETRY_CONTENT_POLICY = {
  defaultLevel: 'standard' as const,
  levels: ['minimal', 'standard', 'full'] as const,
  fullContentRequiresOptIn: true,
  alwaysRedacted: ['credentials', 'authorization headers', 'cookies', 'connection strings'],
  neverCollected: ['portfolio holdings', 'account balances', 'private conversation storage'],
};

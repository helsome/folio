/**
 * Secret redaction for diagnostics exports (spec §36).
 *
 * Applied before serialization so API keys, OAuth tokens, raw credentials,
 * and base64-ish blobs can never leave the machine. Private conversation
 * contents and portfolio details are never collected in the first place —
 * redaction is the last line of defense for anything that slips through in a
 * message/stack string.
 */

const REDACTED = '[REDACTED]';

export const REDACTION_POLICY =
  'Strips API keys (sk-/rk-/pk-/ak-…), AWS access keys (AKIA…), Bearer and ' +
  'X-Api-Key/Authorization tokens, JWTs, VCS tokens (gh*/github_pat_), ' +
  'LangSmith keys (lsv2_pt_/lsv2_sk_…), and base64-ish blobs. Private ' +
  'conversation contents and portfolio details are never collected.';

type Replacement = string;

const PATTERNS: ReadonlyArray<readonly [RegExp, Replacement]> = [
  // OpenAI/Anthropic-style keys: sk-…, sk-ant-…, rk-/pk-/ak-… (dash or not).
  [/\b(?:sk-ant-|sk-|rk-|pk-|ak-)[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // AWS access key ids (20 uppercase alphanumeric chars prefixed with AKIA).
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // Bearer auth headers: keep the scheme, redact the token.
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/g, `$1${REDACTED}`],
  // API-key headers / JSON fields: x-api-key, X-Api-Key, apiKey, api_key.
  [/(["']?(?:x-api-key|X-Api-Key|api[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}["']?/g, `$1${REDACTED}`],
  // JWTs (header.payload.signature).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // GitHub / common VCS tokens.
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{8,}\b/g, REDACTED],
  // LangSmith API keys: lsv2_pt_/lsv2_sk_ prefixes, or a bare lsv2_ + 8+ chars.
  // The suffix is hex, which the base64 pattern below deliberately skips, and
  // contains underscores, which the api-key header pattern cannot span.
  [/\blsv2_(?:pt_|sk_)?[A-Za-z0-9]{8,}\b/g, REDACTED],
  // Base64-ish blobs: long runs (≥40 chars) that include an uppercase char,
  // which excludes lowercase git SHAs and hex identifiers.
  [/\b(?=[A-Za-z0-9+/]{40,}={0,2})(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}/g, REDACTED],
];

/** Strip secret-shaped material from a string, preserving surrounding text. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

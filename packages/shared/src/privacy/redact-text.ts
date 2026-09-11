// String-level secret redaction — the single pattern source for every
// outbound-data boundary (issue #19). `redactText` strips credential-shaped
// material while preserving surrounding text, so traces keep run ids, tool
// names, latencies and statuses. It is fail-closed: if the pattern engine
// itself misbehaves, the whole string is replaced with REDACTED rather than
// falling back to the raw payload.
import { REDACTED } from './policy.ts';

type Replacement = string;

/**
 * Ordered rules applied left to right. Earlier matches win; later rules see
 * text that already contains [REDACTED] markers, which no rule re-matches,
 * keeping the engine idempotent.
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, Replacement]> = [
  // PEM private key blocks — before the base64 rule so the armor survives.
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY(?: BLOCK)?-----/g, REDACTED],
  // OpenAI/Anthropic-style keys: sk-…, sk-ant-…, rk-/pk-/ak-… (dash or not).
  [/\b(?:sk-ant-|sk-|rk-|pk-|ak-)[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // AWS access key ids (20 uppercase alphanumeric chars prefixed with AKIA).
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // Bearer / Basic auth headers: keep the scheme, redact the token.
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/g, `$1${REDACTED}`],
  [/\b(Basic\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
  // Cookie / session headers (also JSON/`k=v` forms): the whole value is sensitive.
  [/(\b(?:cookie|set-cookie|(?:x[-_])?session[_-]?token)["']?\s*[:=]\s*["']?)[^"'\r\n]{4,}/gi, `$1${REDACTED}`],
  // Connection strings with userinfo credentials: postgres://user:pass@host,
  // redis://:pass@host, mongodb+srv://… — keep the scheme and host, drop the creds.
  [/\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|ftp|ftps|sftp|https?|wss?):\/\/)[^\s:@/"']*:[^\s@/"']+@/g, `$1${REDACTED}@`],
  // Secret query parameters in URLs: ?apikey=…&token=…&signature=….
  [/([?&#](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?(?:id|token)|auth|token|secret|password|passwd|signature|credentials?)=)[^&\s"'>]{4,}/gi, `$1${REDACTED}`],
  // Webhook signatures & shared secrets.
  [/\bwhsec_[A-Za-z0-9]{8,}\b/g, REDACTED],
  [/((?:x-hub-signature(?:-256)?|x-webhook-signature|x-signature|x-signal-signature)["']?\s*[:=]\s*["']?)[A-Za-z0-9=+/_-]{8,}/gi, `$1${REDACTED}`],
  // API-key headers / JSON fields: x-api-key, X-Api-Key, apiKey, api_key.
  [/(["']?(?:x-api-key|X-Api-Key|api[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}["']?/g, `$1${REDACTED}`],
  // AWS secret access keys in key/value context (40-char base64ish).
  [/((?:aws_secret_access_key|secret_access_key|SecretAccessKey)["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{35,}/g, `$1${REDACTED}`],
  // JWTs (header.payload.signature).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // GitHub / common VCS tokens.
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{8,}\b/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{30,}\b/g, REDACTED],
  // LangSmith API keys: lsv2_pt_/lsv2_sk_ prefixes, or a bare lsv2_ + 8+ chars.
  // The suffix is hex, which the base64 pattern below deliberately skips, and
  // contains underscores, which the api-key header pattern cannot span.
  [/\blsv2_(?:pt_|sk_)?[A-Za-z0-9]{8,}\b/g, REDACTED],
  // Slack tokens (xoxb-/xoxp-/…), SendGrid keys, Google API keys / OAuth.
  [/\bxox[baprsce]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED],
  [/\bya29\.[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Base64-ish blobs: long runs (≥40 chars) that include an uppercase char,
  // which excludes lowercase git SHAs and hex identifiers.
  [/\b(?=[A-Za-z0-9+/]{40,}={0,2})(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}/g, REDACTED],
];

/**
 * Strip secret-shaped material from a string, preserving surrounding text.
 * Fail-closed: on an internal error the entire string becomes REDACTED —
 * redaction never falls back to emitting the raw payload.
 */
export function redactText(text: string): string {
  try {
    let out = text;
    for (const [pattern, replacement] of PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  } catch {
    return REDACTED;
  }
}

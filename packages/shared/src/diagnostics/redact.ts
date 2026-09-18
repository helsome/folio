/**
 * Secret redaction for diagnostics exports (spec §36).
 *
 * The implementation now lives in the shared privacy module (issue #19) so
 * logs, diagnostics, telemetry and eval artifacts redact with the same rule
 * source. Applied before serialization so API keys, OAuth tokens, raw
 * credentials, cookies, connection strings and base64-ish blobs can never
 * leave the machine. Private conversation contents and portfolio details are
 * never collected in the first place — redaction is the last line of defense
 * for anything that slips through in a message/stack string.
 */
export { redactText as redact } from '../privacy/redact-text.ts';
export { REDACTION_POLICY } from '../privacy/policy.ts';

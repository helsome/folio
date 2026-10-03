// Unified redaction / data-minimization contract (issue #19).
//
// One rule source for every boundary where data leaves the core runtime:
// kernel logs, diagnostics bundles, LangSmith/Langfuse telemetry, eval
// artifacts, IPC error serialization and report exports. The modules under
// `diagnostics/`, `evaluation/` and `export/` re-export or delegate to this
// module; new boundaries must import from here rather than growing their own
// regex lists.
export {
  ACCOUNT_LIKE_KEY,
  DEFAULT_TELEMETRY_CONTENT_POLICY,
  isNumeric,
  isSecretField,
  REDACTED,
  REDACTION_POLICY,
  SECRET_FIELD_NAMES,
} from './policy.ts';
export { redactText } from './redact-text.ts';
export { deepRedact, redactError } from './deep-redact.ts';
export type { DeepRedactOptions, DeepRedactResult, RedactedError } from './deep-redact.ts';

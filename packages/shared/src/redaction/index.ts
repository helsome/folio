export {
  Redactor,
  redactString,
  sanitize,
  type PrivacyLevel,
  type RedactionOptions,
  type RedactionResult,
} from './redactor.ts';

export {
  REDACTED,
  REDACTED_POLICY_DOC,
  SECRET_PATTERNS,
  SECRET_FIELD_NAMES,
  isSecretFieldName,
  isPortfolioToolName,
} from './patterns.ts';

export {
  CanaryScanner,
  generateCanarySeeds,
  type CanarySecret,
  type ScanResult,
} from './canary.ts';

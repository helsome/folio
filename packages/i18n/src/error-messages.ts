/**
 * Stable ApiError.code  →  translation key (errors.*) resolver (spec §50–51).
 *
 * Codes are domain identifiers (never translated, never rewritten); only the
 * *display* copy is localised. `translateErrorMessage` looks up the mapping
 * and falls back to a sanitized technical message when no code matches —
 * raw stack traces are never shown to users (spec §51, §104-105).
 */
import type { TFunction } from 'i18next';
import type { errors as enErrors } from './locales/en-US/errors.ts';

type ErrorKey = keyof typeof enErrors;

/** Static table: code → resource key. Codes stay stable across locales. */
export const ERROR_CODE_TO_KEY: Readonly<Record<string, ErrorKey>> = {
  UNKNOWN_ERROR: 'unknown',
  INVALID_ARGUMENT: 'invalidArgument',
  STORAGE_READ_FAILED: 'storageReadFailed',
  STORAGE_WRITE_FAILED: 'storageWriteFailed',
  PI_RUNTIME_NOT_FOUND: 'piRuntimeNotFound',
  PI_RUNTIME_ERROR: 'piRuntimeError',
  PI_RUNTIME_STOPPED: 'piRuntimeStopped',
  PI_PROTOCOL_ERROR: 'piProtocolError',
  PI_REQUEST_TIMEOUT: 'piRequestTimeout',
  PI_HEALTH_TIMEOUT: 'piHealthTimeout',
  PI_TOOL_TIMEOUT: 'piToolTimeout',
  PI_TOOL_LIMIT_EXCEEDED: 'piToolLimitExceeded',
  TOOL_NOT_FOUND: 'toolNotFound',
  SESSION_NOT_FOUND: 'sessionNotFound',
  RESEARCH_SYMBOL_INVALID: 'researchSymbolInvalid',
  RESEARCH_RUN_NOT_FOUND: 'researchRunNotFound',
  REPORT_NOT_FOUND: 'reportNotFound',
  SYNTHESIS_TIMEOUT: 'synthesisTimeout',
  SYNTHESIS_PARSE_ERROR: 'synthesisParseError',
  SYNTHESIS_CANCELLED: 'synthesisCancelled',
  THESIS_NOT_FOUND: 'thesisNotFound',
  THESIS_PARSE_ERROR: 'thesisParseError',
  JUDGE_PARSE_ERROR: 'judgeParseError',
  PERFORMANCE_HORIZON_INVALID: 'performanceHorizonInvalid',
  SCREENING_STRATEGY_INVALID: 'screeningStrategyInvalid',
  IMPORT_EMPTY: 'importEmpty',
  IMPORT_SOURCE_INVALID: 'importSourceInvalid',
  AUTOMATION_RULE_INVALID: 'automationRuleInvalid',
  AUTOMATION_RULE_NOT_FOUND: 'automationRuleNotFound',
  LOGIN_IN_PROGRESS: 'loginInProgress',
  LOGIN_START_FAILED: 'loginStartFailed',
  UNKNOWN_PROVIDER: 'unknownProvider',
  CONFIG_UNSUPPORTED: 'configUnsupported',
};

/** Resolve a stable code to its errors.* key, or null when unmapped. */
export function errorKeyForCode(code: string | undefined): ErrorKey | null {
  if (typeof code !== 'string') return null;
  return ERROR_CODE_TO_KEY[code] ?? null;
}

/** Localised, user-safe error message for a code; null when unmapped. */
export function translateErrorCode(code: string | undefined, t: TFunction): string | null {
  const key = errorKeyForCode(code);
  return key === null ? null : t(`errors.${key}`);
}

/**
 * User-facing error copy keyed by stable ApiError.code (spec §50–51).
 *
 * Resolution: translateErrorCode(code) → this table; unknown/unmatched codes
 * fall back to a sanitized technical message (shown only in Diagnostics).
 * Codes are stable domain identifiers and are NEVER translated (spec §10).
 */
export const errors = {
  unknown: 'Something went wrong. Please try again.',
  sectionUnexpected: 'Something went wrong',
  sectionUnexpectedDetail:
    'An unexpected error occurred in this section. Retry, or open Diagnostics to inspect the app state and export a support bundle.',
  sectionOpenDiagnostics: 'Open Diagnostics',
  invalidArgument: 'The request was invalid.',
  storageReadFailed: 'Could not read Folio data. Please try again.',
  storageWriteFailed: 'Could not save changes. Please try again.',
  piRuntimeNotFound: 'The agent runtime is not available.',
  piRuntimeError: 'The agent runtime encountered an error.',
  piRuntimeStopped: 'The agent runtime stopped unexpectedly.',
  piProtocolError: 'The agent runtime sent an unexpected response.',
  piRequestTimeout: 'The agent runtime took too long to respond.',
  piHealthTimeout: 'The agent runtime did not respond to a health check.',
  piToolTimeout: 'A finance tool call timed out.',
  piToolLimitExceeded: 'Too many tool calls were made for this request.',
  toolNotFound: 'The requested finance tool is not available.',
  sessionNotFound: 'This conversation no longer exists.',
  researchSymbolInvalid: 'Please enter a valid symbol to research.',
  researchRunNotFound: 'This research run no longer exists.',
  reportNotFound: 'This research report no longer exists.',
  synthesisTimeout: 'Research analysis timed out.',
  synthesisParseError: 'Research analysis could not be interpreted.',
  synthesisCancelled: 'Research analysis was cancelled.',
  thesisNotFound: 'This investment thesis no longer exists.',
  thesisParseError: 'The thesis could not be interpreted.',
  judgeParseError: 'Evaluation scoring could not be interpreted.',
  performanceHorizonInvalid: 'That performance range is not supported.',
  screeningStrategyInvalid: 'That screening strategy is not supported.',
  importEmpty: 'No positions were found to import.',
  importSourceInvalid: 'The import source is not valid.',
  automationRuleInvalid: 'That automation rule is not valid.',
  automationRuleNotFound: 'That automation rule no longer exists.',
  loginInProgress: 'A provider sign-in is already in progress.',
  loginStartFailed: 'Provider sign-in could not be started.',
  unknownProvider: 'That provider is not recognized.',
  configUnsupported: 'That configuration option is not supported.',
} satisfies Record<string, string>;

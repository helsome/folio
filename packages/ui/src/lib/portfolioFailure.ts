import type { PortfolioFailure, PortfolioFailureKind, PortfolioSnapshot } from '@finagent/core'

/**
 * Portfolio failure classification for the UI (spec §19). The renderer receives
 * an IPC error envelope (`{ code, message }`), not the Longbridge error object,
 * so this lives UI-side and maps the stable machine code to a failure kind with
 * a user-safe message. Empty/partial states are derived from the snapshot data.
 */

const CODE_KINDS: Record<string, PortfolioFailureKind> = {
  AUTH_EXPIRED: 'no-account-permission',
  TIMEOUT: 'timeout',
  PARSE_FAILURE: 'parse-error',
  LONGBRIDGE_NOT_INSTALLED: 'not-connected',
  LONGBRIDGE_NOT_AUTHED: 'no-account-permission',
  LONGBRIDGE_TIMEOUT: 'timeout',
  LONGBRIDGE_PARSE_FAILURE: 'parse-error',
}

/**
 * Safety net, not display copy: a `PortfolioFailure.message` may never carry raw
 * vendor output, so every kind gets a non-vendor sentence even when the IPC
 * envelope has nothing usable. The UI renders localized copy keyed by `kind`
 * instead of these strings (see `PortfolioSection`), because they are English-only.
 */
const KIND_MESSAGES: Record<PortfolioFailureKind, string> = {
  'not-connected': 'LongBridge is not connected. Install or configure the CLI and try again.',
  'no-account-permission': 'This LongBridge account does not grant portfolio access.',
  empty: 'No portfolio data yet.',
  partial: 'Account totals loaded, but holdings could not be read.',
  'provider-error': 'LongBridge could not return portfolio data.',
  'parse-error': 'Portfolio data could not be read in the expected format.',
  timeout: 'LongBridge took too long to respond.',
}

/**
 * Localized detail copy for a failure. `KIND_MESSAGES` is English-only, so the
 * rendered sentence comes from the locale bundle instead: a heading plus a
 * hardcoded English sentence is the bug this map exists to close. Mirrors
 * `KIND_MESSAGES` one-for-one, and adopts the fuller main-process wording —
 * `no-account-permission` had already lost its second sentence in the UI copy.
 */
const FAILURE_DETAIL_KEYS: Record<PortfolioFailureKind, string> = {
  'not-connected': 'portfolio.failureDetail.notConnected',
  'no-account-permission': 'portfolio.failureDetail.noPermission',
  empty: 'portfolio.failureDetail.empty',
  partial: 'portfolio.failureDetail.partial',
  'provider-error': 'portfolio.failureDetail.providerError',
  'parse-error': 'portfolio.failureDetail.parseError',
  timeout: 'portfolio.failureDetail.timeout',
}

/** Shape shared by `useTranslation().t` and the test i18n bundles. */
type Translate = (key: string, options?: Record<string, unknown>) => string

interface IpcErrorLike {
  code?: string
  message?: string
}

/** Map an IPC error envelope (or any thrown value) to a `PortfolioFailure`. */
export function portfolioFailureFromError(error: unknown): PortfolioFailure {
  const code = (error as IpcErrorLike | null | undefined)?.code
  const kind = code !== undefined && CODE_KINDS[code] !== undefined
    ? CODE_KINDS[code]
    : 'provider-error'
  if (kind !== 'provider-error') {
    return { kind, message: KIND_MESSAGES[kind] }
  }
  const message = (error as IpcErrorLike | null | undefined)?.message?.trim()
  return { kind, message: message !== '' && message !== undefined ? message : KIND_MESSAGES[kind] }
}

/**
 * The raw diagnostic behind a failure, when there is one.
 *
 * `provider-error` is the only kind whose `message` can hold something the kind
 * alone cannot express — an envelope message with the vendor output already
 * trimmed out. Every other kind's message is the fixed `KIND_MESSAGES`
 * sentence, which the UI replaces with localized copy keyed by `kind`, so
 * returning it here would shadow the translation with hardcoded English.
 */
export function portfolioFailureDiagnostic(failure: PortfolioFailure): string | undefined {
  if (failure.kind !== 'provider-error') return undefined
  const message = failure.message.trim()
  return message !== '' && message !== KIND_MESSAGES['provider-error'] ? message : undefined
}

/**
 * The sentence to render under a failure heading: the raw diagnostic when the
 * failure carries one, else the localized copy for its kind. Callers pass a
 * `t` so the copy follows the locale at render time, not at classification time.
 */
export function portfolioFailureDetail(t: Translate, failure: PortfolioFailure): string {
  return portfolioFailureDiagnostic(failure) ?? t(FAILURE_DETAIL_KEYS[failure.kind])
}

/** Derive `empty`/`partial` from a loaded snapshot; undefined when healthy. */
export function portfolioFailureFromSnapshot(snapshot: PortfolioSnapshot): PortfolioFailure | undefined {
  const hasTotals =
    (snapshot.totalAssets ?? 0) > 0 ||
    (snapshot.marketValue ?? 0) > 0 ||
    snapshot.accounts.some((a) => (a.netAssets ?? 0) > 0 || (a.marketValue ?? 0) > 0)

  if (snapshot.holdings.length === 0 && !hasTotals) {
    return { kind: 'empty', message: KIND_MESSAGES.empty }
  }
  if (snapshot.holdings.length === 0 && hasTotals) {
    return { kind: 'partial', message: KIND_MESSAGES.partial, partialData: true }
  }
  return undefined
}

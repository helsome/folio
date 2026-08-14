import type { PortfolioFailure, PortfolioFailureKind, PortfolioSnapshot } from '@finagent/core'

/**
 * Portfolio failure classification for the UI (spec §19). The renderer receives
 * an IPC error envelope (`{ code, message }`), not the Longbridge error object,
 * so this lives UI-side and maps the stable machine code to a failure kind with
 * a user-safe message. Empty/partial states are derived from the snapshot data.
 */

const CODE_KINDS: Record<string, PortfolioFailureKind> = {
  LONGBRIDGE_NOT_INSTALLED: 'not-connected',
  LONGBRIDGE_NOT_AUTHED: 'no-account-permission',
  LONGBRIDGE_TIMEOUT: 'timeout',
  LONGBRIDGE_PARSE_FAILURE: 'parse-error',
}

const KIND_MESSAGES: Record<PortfolioFailureKind, string> = {
  'not-connected': 'LongBridge is not connected. Install or configure the CLI and try again.',
  'no-account-permission': 'This LongBridge account does not grant portfolio access.',
  empty: 'No portfolio data yet.',
  partial: 'Account totals loaded, but holdings could not be read.',
  'provider-error': 'LongBridge could not return portfolio data.',
  'parse-error': 'Portfolio data could not be read in the expected format.',
  timeout: 'LongBridge took too long to respond.',
}

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

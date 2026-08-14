export type ErrorCode =
  | 'LONGBRIDGE_NOT_INSTALLED'
  | 'LONGBRIDGE_NOT_AUTHED'
  | 'LONGBRIDGE_RATE_LIMITED'
  | 'LONGBRIDGE_TIMEOUT'
  | 'INVALID_SYMBOL'
  | 'LONGBRIDGE_PARSE_FAILURE'
  | 'LONGBRIDGE_UNKNOWN';

export class LongBridgeError extends Error {
  code: ErrorCode;
  /** Raw vendor output for diagnostics. NEVER rendered to users or sent over IPC. */
  debug?: string;

  constructor(message: string, code: ErrorCode, debug?: string) {
    super(message);
    this.name = 'LongBridgeError';
    this.code = code;
    if (debug !== undefined) this.debug = debug;
  }
}

export function isLongBridgeError(error: unknown): error is LongBridgeError {
  return error instanceof LongBridgeError;
}

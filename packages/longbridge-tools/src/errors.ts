export type ErrorCode =
  | 'LONGBRIDGE_NOT_INSTALLED'
  | 'LONGBRIDGE_NOT_AUTHED'
  | 'LONGBRIDGE_TIMEOUT'
  | 'INVALID_SYMBOL'
  | 'LONGBRIDGE_PARSE_FAILURE'
  | 'LONGBRIDGE_UNKNOWN';

export class LongBridgeError extends Error {
  code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = 'LongBridgeError';
    this.code = code;
  }
}

export function isLongBridgeError(error: unknown): error is LongBridgeError {
  return error instanceof LongBridgeError;
}

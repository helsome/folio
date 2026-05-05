export type ErrorCode =
  | 'LONGBRIDGE_NOT_INSTALLED'
  | 'LONGBRIDGE_NOT_AUTHED'
  | 'LONGBRIDGE_TIMEOUT'
  | 'INVALID_SYMBOL'
  | 'LONGBRIDGE_UNKNOWN';

export class LongBridgeError extends Error {
  constructor(
    message: string,
    public code: ErrorCode
  ) {
    super(message);
    this.name = 'LongBridgeError';
  }
}

export function isLongBridgeError(error: unknown): error is LongBridgeError {
  return error instanceof LongBridgeError;
}
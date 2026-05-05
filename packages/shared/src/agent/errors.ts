import type { ApiError } from '@finagent/core';

export function toApiError(error: unknown): ApiError {
  if (isErrorWithCode(error)) {
    return {
      code: error.code,
      message: error.message,
      action: error.action,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
  };
}

export function createCodeError(code: string, message: string, action?: string) {
  const error = new Error(message) as Error & { code: string; action?: string };
  error.code = code;
  error.action = action;
  return error;
}

function isErrorWithCode(error: unknown): error is Error & { code: string; action?: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

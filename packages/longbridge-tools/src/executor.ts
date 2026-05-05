import { execa } from 'execa';
import { LongBridgeError, isLongBridgeError } from './errors.ts';

export interface ExecutorOptions {
  timeout?: number;
}

export async function executeLongBridge(
  args: string[],
  options: ExecutorOptions = {}
): Promise<string> {
  const { timeout = 30000 } = options;

  try {
    const { stdout } = await execa('longbridge', args, {
      timeout,
    });
    return stdout;
  } catch (error) {
    throw normalizeLongBridgeError(error);
  }
}

interface ExecaLikeError extends Error {
  code?: string;
  timedOut?: boolean;
  stderr?: string;
  stdout?: string;
}

export function normalizeLongBridgeError(error: unknown): LongBridgeError {
  if (isLongBridgeError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const execaError = error as ExecaLikeError;
    const details = `${error.message}\n${execaError.stderr ?? ''}\n${execaError.stdout ?? ''}`.toLowerCase();

    if (execaError.code === 'ENOENT' || details.includes('enoent')) {
      return new LongBridgeError('LongBridge CLI is not installed or not on PATH', 'LONGBRIDGE_NOT_INSTALLED');
    }
    if (execaError.timedOut || details.includes('timed out') || details.includes('timeout')) {
      return new LongBridgeError('LongBridge command timed out', 'LONGBRIDGE_TIMEOUT');
    }
    if (
      details.includes('429002') ||
      details.includes('rate limited') ||
      details.includes('request is limited') ||
      details.includes('slow down request frequency')
    ) {
      return new LongBridgeError(
        'LongBridge API rate limit reached. Wait a moment and retry.',
        'LONGBRIDGE_RATE_LIMITED'
      );
    }
    if (
      details.includes('not authenticated') ||
      details.includes('authentication failed') ||
      details.includes('auth required') ||
      details.includes('unauthorized') ||
      details.includes('oauth failed') ||
      details.includes('please login') ||
      details.includes('please log in')
    ) {
      return new LongBridgeError('LongBridge authentication is required', 'LONGBRIDGE_NOT_AUTHED');
    }

    return new LongBridgeError(error.message, 'LONGBRIDGE_UNKNOWN');
  }

  return new LongBridgeError('Unknown LongBridge failure', 'LONGBRIDGE_UNKNOWN');
}

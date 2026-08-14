import type {
  CapabilityExecutionContext,
  CapabilityResult,
  CapabilityRunRecord,
  CapabilityRunStatus,
  FinanceCapability,
} from '@finagent/core';

/**
 * Provider error codes that mean "can't serve right now" (missing CLI, missing
 * auth, rate limited, or the provider timed out) rather than a data/logic
 * failure. These map a run to `unavailable`.
 */
const UNAVAILABLE_ERROR_CODES = {
  LONGBRIDGE_NOT_INSTALLED: true,
  LONGBRIDGE_NOT_AUTHED: true,
  LONGBRIDGE_RATE_LIMITED: true,
  LONGBRIDGE_TIMEOUT: true,
} as const;

export interface CapabilityExecutorOptions {
  now?: () => number;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunOutcome {
  record: CapabilityRunRecord;
  result?: CapabilityResult<unknown>;
}

export interface RunAllSpec {
  cap: FinanceCapability;
  input: unknown;
}

export interface RunAllOptions {
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Runs capabilities under timeout/abort control and records every execution as
 * a `CapabilityRunRecord`. Failures never reject: they fold into the record's
 * status (`failed`, `unavailable`, or `cancelled`), so callers can always
 * inspect what happened instead of unwinding.
 */
export class CapabilityExecutor {
  private readonly now: () => number;
  private sequence = 0;

  constructor(options: CapabilityExecutorOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async run(cap: FinanceCapability, input: unknown, options: RunOptions = {}): Promise<RunOutcome> {
    const startedAt = this.now();
    this.sequence += 1;
    const id = `run-${cap.id}-${startedAt}-${this.sequence}`;

    if (options.signal?.aborted) {
      return {
        record: {
          id,
          capabilityId: cap.id,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          status: 'cancelled',
          error: abortMessage(options.signal.reason),
        },
      };
    }

    const controller = new AbortController();
    const ctx: CapabilityExecutionContext = { signal: controller.signal, now: this.now };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(
        () => controller.abort(createAbortReason(`Capability ${cap.id} timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs
      );
    }

    const onExternalAbort = () => controller.abort(options.signal?.reason);
    if (options.signal) {
      options.signal.addEventListener('abort', onExternalAbort);
      // Re-check: the signal may have aborted between the entry check and subscribe.
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      }
    }

    try {
      const result = await cap.execute(input, ctx);
      const finishedAt = this.now();
      return {
        record: {
          id,
          capabilityId: cap.id,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          status: 'success',
          provenance: result.provenance,
        },
        result,
      };
    } catch (error) {
      const finishedAt = this.now();
      return {
        record: {
          id,
          capabilityId: cap.id,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          status: classifyStatus(error, controller.signal),
          error: errorMessage(error),
        },
      };
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
    }
  }

  async runAll(specs: RunAllSpec[], options: RunAllOptions = {}): Promise<RunOutcome[]> {
    if (specs.length === 0) return [];

    const concurrency = Math.max(1, options.concurrency ?? specs.length);
    const results = new Array<RunOutcome>(specs.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, specs.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= specs.length) break;
        const spec = specs[index];
        results[index] = await this.run(spec.cap, spec.input, {
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
      }
    });

    await Promise.allSettled(workers);
    return results;
  }
}

function classifyStatus(error: unknown, signal: AbortSignal): CapabilityRunStatus {
  if (signal.aborted) return 'cancelled';
  if (isUnavailableError(error)) return 'unavailable';
  return 'failed';
}

function isUnavailableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' && Object.hasOwn(UNAVAILABLE_ERROR_CODES, code);
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function abortMessage(reason?: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason !== undefined && reason !== null) return String(reason);
  return 'Run aborted before start.';
}

function createAbortReason(message: string) {
  const error = new Error(message) as Error & { code: string };
  error.name = 'AbortError';
  error.code = 'CAPABILITY_TIMEOUT';
  return error;
}

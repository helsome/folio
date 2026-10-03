import type { ErrorLogEntry } from './types.ts';
import { redactText } from '../privacy/redact-text.ts';

export interface ErrorLogOptions {
  /** Maximum retained entries; older entries are evicted. Defaults to 50. */
  capacity?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * A fixed-capacity ring buffer of recent errors (spec §35 "last errors").
 *
 * `push` normalizes each entry (no `undefined` fields) and evicts the oldest
 * once capacity is exceeded. `recent(n)` returns the newest `n` entries,
 * newest first — the order the Diagnostics UI shows them in.
 *
 * Messages and stacks are redacted at collection time (issue #19): stack
 * first lines echo the raw error message, which may carry Authorization
 * headers, signed URLs or connection strings from the failing call.
 */
export class ErrorLog {
  private readonly capacity: number;
  private readonly now: () => number;
  private entries: ErrorLogEntry[] = [];

  constructor(options: ErrorLogOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 50));
    this.now = options.now ?? Date.now;
  }

  push(entry: {
    at?: number;
    message: string;
    source?: string | null;
    stack?: string | null;
  }): void {
    const normalized: ErrorLogEntry = {
      at: entry.at ?? this.now(),
      source: entry.source ?? null,
      message: redactText(entry.message),
      stack: entry.stack ? redactText(entry.stack) : null,
    };
    this.entries.push(normalized);
    if (this.entries.length > this.capacity) {
      this.entries = this.entries.slice(this.entries.length - this.capacity);
    }
  }

  /** Most-recent-first snapshot of up to `n` entries. */
  recent(n: number): ErrorLogEntry[] {
    if (n <= 0) return [];
    return this.entries.slice(-n).reverse();
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

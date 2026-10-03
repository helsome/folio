// Deep value redaction and error serialization on top of the shared policy
// (issue #19). Used where structured payloads — tool args/results, evaluation
// records, telemetry metadata — cross an outbound boundary. Fail-closed: a
// walk that goes wrong (cycles, depth, exotic objects) yields REDACTED nodes,
// never the raw input.
import { isSecretField, REDACTED } from './policy.ts';
import { redactText } from './redact-text.ts';

/** Defensive cap: payloads nested deeper than this are redacted wholesale. */
const MAX_DEPTH = 32;

export interface DeepRedactResult {
  /** Structurally safe copy of the input; never the raw input. */
  value: unknown;
  /** Field paths whose values were replaced (for diagnostics, never values). */
  redactedPaths: string[];
}

export interface DeepRedactOptions {
  /**
   * Extra secret-field predicate layered onto the shared field-name rules,
   * e.g. boundary-specific key shapes the shared policy does not know.
   */
  isSecretField?: (path: string) => boolean;
}

/**
 * Deep-redact an arbitrary JSON-ish value: credential-named fields become
 * REDACTED, every string passes through `redactText`. Cyclic references and
 * over-deep structures are replaced with REDACTED instead of throwing — the
 * raw payload is never returned as a fallback.
 */
export function deepRedact(value: unknown, options: DeepRedactOptions = {}): DeepRedactResult {
  const paths: string[] = [];
  const seen = new WeakSet<object>();
  const isSecret = (path: string): boolean =>
    isSecretField(path) || (options.isSecretField?.(path) ?? false);

  const walk = (node: unknown, path: string, depth: number): unknown => {
    if (typeof node === 'string') {
      if (path && isSecret(path)) {
        paths.push(path);
        return REDACTED;
      }
      const cleaned = redactText(node);
      if (cleaned !== node) paths.push(path);
      return cleaned;
    }
    if (typeof node !== 'object' || node === null) return node;
    if (depth >= MAX_DEPTH) {
      paths.push(path || '<deep>');
      return REDACTED;
    }
    if (seen.has(node)) {
      paths.push(path || '<cyclic>');
      return REDACTED;
    }
    seen.add(node);
    try {
      if (Array.isArray(node)) {
        return node.map((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      }
      const record = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSecret(childPath)) {
          paths.push(childPath);
          out[key] = REDACTED;
          continue;
        }
        out[key] = walk(child, childPath, depth + 1);
      }
      return out;
    } catch {
      paths.push(path || '<error>');
      return REDACTED;
    }
  };

  return { value: walk(value, '', 0), redactedPaths: paths };
}

export interface RedactedError {
  message: string;
  stack: string | null;
}

/**
 * Serialize an unknown thrown value with message and stack redacted. This is
 * the boundary rule for error logs, IPC error payloads and diagnostics —
 * exception text frequently echoes Authorization headers, signed URLs or
 * connection strings from the failing HTTP call.
 */
export function redactError(error: unknown): RedactedError {
  try {
    const message = redactText(error instanceof Error ? error.message : String(error));
    const stack = error instanceof Error && typeof error.stack === 'string'
      ? redactText(error.stack)
      : null;
    return { message, stack };
  } catch {
    // Fail closed: never serialize a raw error we could not redact.
    return { message: REDACTED, stack: null };
  }
}

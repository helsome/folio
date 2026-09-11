import type { ToolCallRecord } from '@finagent/core';
import {
  REDACTED,
  SECRET_PATTERNS,
  isSecretFieldName,
  isPortfolioToolName,
} from './patterns.ts';

/**
 * Privacy levels (issue #19).
 *
 * - minimal: names, status, durations, counts only — no content, no args
 * - standard: prompt/answer/tool args allowed after redaction; portfolio results downgraded
 * - full: complete trace, still credential-redacted. Explicit opt-in only.
 */
export type PrivacyLevel = 'minimal' | 'standard' | 'full';

export interface RedactionOptions {
  /** Privacy level (default: 'standard'). */
  privacyLevel?: PrivacyLevel;
  /** Owning tool name, used for portfolio downgrade rules. */
  toolName?: string;
  /** Skip string-pattern redaction (only redact by field name). */
  skipStringPatterns?: boolean;
}

export interface RedactionResult<T> {
  /** The redacted value (safe to send to logs/telemetry). */
  redacted: T;
  /** Field paths that were redacted (for diagnostics, never values). */
  redactedFieldPaths: string[];
  /** True when any portfolio payload was downgraded to a summary. */
  portfolioDowngraded: boolean;
}

/**
 * Unified redaction engine (issue #19).
 *
 * Single entry point for sanitizing any data before it leaves the core runtime:
 * logs, diagnostics, telemetry, traces, eval artifacts, exports.
 *
 * Usage:
 *   const redactor = new Redactor({ privacyLevel: 'standard' });
 *   const { redacted } = redactor.sanitize(payload, { toolName: 'get_portfolio' });
 */
export class Redactor {
  private readonly privacyLevel: PrivacyLevel;

  constructor(options: { privacyLevel?: PrivacyLevel } = {}) {
    this.privacyLevel = options.privacyLevel ?? 'standard';
  }

  /**
   * Redact a string using all known secret patterns.
   * Always runs, regardless of privacy level.
   */
  redactString(text: string): string {
    let out = text;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  /**
   * Deep-redact an arbitrary JSON value.
   * Returns a structurally safe copy plus metadata about what was redacted.
   */
  sanitize(value: unknown, options: RedactionOptions = {}): RedactionResult<unknown> {
    const paths: string[] = [];
    let portfolioDowngraded = false;

    // Portfolio downgrade at standard/minimal levels
    const isPortfolioResult =
      options.toolName !== undefined && isPortfolioToolName(options.toolName);
    if (isPortfolioResult && this.privacyLevel !== 'full') {
      return {
        redacted: this.portfolioSummary(value),
        redactedFieldPaths: ['<portfolio>'],
        portfolioDowngraded: true,
      };
    }

    const walk = (node: unknown, path: string): unknown => {
      // Strings: redact by field name first, then by pattern
      if (typeof node === 'string') {
        if (isSecretFieldName(path)) {
          paths.push(path);
          return REDACTED;
        }
        if (!options.skipStringPatterns) {
          const cleaned = this.redactString(node);
          if (cleaned !== node) paths.push(path);
          return cleaned;
        }
        return node;
      }

      // Primitives: pass through
      if (typeof node !== 'object' || node === null) return node;

      // Arrays: recurse into items
      if (Array.isArray(node)) {
        return node.map((item, index) => walk(item, `${path}[${index}]`));
      }

      // Objects: recurse into values, redact secret fields
      const record = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, childValue] of Object.entries(record)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSecretFieldName(childPath)) {
          paths.push(childPath);
          out[key] = REDACTED;
          continue;
        }
        out[key] = walk(childValue, childPath);
      }
      return out;
    };

    const redacted = walk(value, '');
    return { redacted, redactedFieldPaths: paths, portfolioDowngraded };
  }

  /**
   * Sanitize a complete tool call record for the current privacy level.
   * Handles args, result, error, and embedded trace events.
   */
  sanitizeToolCall(toolCall: ToolCallRecord): ToolCallRecord {
    const portfolioTool = isPortfolioToolName(toolCall.toolName);
    const redacted: ToolCallRecord = {
      id: toolCall.id,
      toolName: toolCall.toolName,
      args: {},
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      status: toolCall.status,
      // Errors may embed credential-shaped text even at minimal level
      error: toolCall.error
        ? { ...toolCall.error, message: this.redactString(toolCall.error.message) }
        : undefined,
    };

    if (this.privacyLevel === 'minimal') {
      return redacted; // names + status + timings only
    }

    if (this.privacyLevel === 'standard') {
      redacted.args = this.sanitize(toolCall.args, { toolName: toolCall.toolName })
        .redacted as Record<string, unknown>;
      redacted.result = portfolioTool
        ? this.portfolioSummary(toolCall.result)
        : this.sanitize(toolCall.result, { toolName: toolCall.toolName }).redacted;
      return redacted;
    }

    // full: complete payload; credentials still redacted
    redacted.args = this.sanitize(toolCall.args).redacted as Record<string, unknown>;
    redacted.result = this.sanitize(toolCall.result).redacted;
    if (Array.isArray(toolCall.trace)) {
      redacted.trace = toolCall.trace.map((entry) => ({
        ...entry,
        message: entry.message !== undefined ? this.redactString(entry.message) : undefined,
        data: this.sanitize(entry.data).redacted,
      }));
    }
    return redacted;
  }

  /**
   * Sanitize an assistant answer string.
   * Returns undefined at minimal level (no content at all).
   */
  sanitizeAnswer(answer: string | undefined): string | undefined {
    if (answer === undefined) return undefined;
    if (this.privacyLevel === 'minimal') return undefined;
    return this.redactString(answer);
  }

  /**
   * Schema summary of a portfolio payload: shape + counts, never values.
   * Used at standard/minimal privacy levels for portfolio tool results.
   */
  private portfolioSummary(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      return { type: 'text', length: value.length, redacted: true };
    }
    if (Array.isArray(value)) {
      return { type: 'array', length: value.length, redacted: true };
    }
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value as Record<string, unknown>);
      return { type: 'object', keys: keys.slice(0, 32), redacted: true };
    }
    return { type: typeof value, redacted: true };
  }
}

// ── Convenience singleton for ad-hoc use ─────────────────────────────────────

const defaultRedactor = new Redactor({ privacyLevel: 'standard' });

/**
 * One-shot string redaction (convenience function).
 * Use when you just need to clean a string, not a full object.
 */
export function redactString(text: string): string {
  return defaultRedactor.redactString(text);
}

/**
 * One-shot object sanitization (convenience function, standard privacy level).
 * Use when you just need to clean a JSON payload quickly.
 */
export function sanitize(value: unknown, options?: Omit<RedactionOptions, 'privacyLevel'>): unknown {
  return defaultRedactor.sanitize(value, options).redacted;
}

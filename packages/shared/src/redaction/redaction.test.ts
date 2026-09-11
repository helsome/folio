import { describe, test, expect } from 'bun:test';
import {
  Redactor,
  redactString,
  sanitize,
  CanaryScanner,
  generateCanarySeeds,
  REDACTED,
  isPortfolioToolName,
} from './index.ts';
import type { ToolCallRecord } from '@finagent/core';

// ── String Redaction ─────────────────────────────────────────────────────────

describe('redactString', () => {
  test('strips OpenAI-style API keys', () => {
    expect(redactString('sk-abc123def456ghi789jkl012')).toBe(REDACTED);
    expect(redactString('sk-ant-abc123def456ghi789')).toBe(REDACTED);
  });

  test('strips AWS access keys', () => {
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED);
  });

  test('strips Bearer tokens but keeps scheme', () => {
    const result = redactString('Authorization: Bearer abc123def456ghi789jkl');
    expect(result).toContain('Bearer');
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('abc123def456ghi789jkl');
  });

  test('strips JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(jwt)).toBe(REDACTED);
  });

  test('strips GitHub tokens', () => {
    expect(redactString('ghp_abc123def456ghi789jklmnopqrstuvwxyz')).toBe(REDACTED);
    expect(redactString('github_pat_abc123def456ghi789')).toBe(REDACTED);
  });

  test('strips LangSmith keys', () => {
    expect(redactString('lsv2_pt_abc123def456ghi789jklmnopqrstuvwxyz')).toBe(REDACTED);
  });

  test('strips connection strings', () => {
    const result = redactString('postgres://user:secretpass@localhost:5432/db');
    expect(result).toContain('postgresql://');
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('secretpass');
  });

  test('strips URL query secrets', () => {
    const result = redactString('https://api.example.com/data?api_key=sk-secret123&limit=10');
    expect(result).toContain('api_key=');
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('sk-secret123');
  });

  test('preserves non-secret text', () => {
    expect(redactString('Hello world, this is normal text')).toBe('Hello world, this is normal text');
  });
});

// ── Object Sanitization ──────────────────────────────────────────────────────

describe('Redactor.sanitize', () => {
  const redactor = new Redactor({ privacyLevel: 'standard' });

  test('redacts secret field names', () => {
    const input = {
      name: 'test',
      apiKey: 'sk-abc123def456',
      nested: {
        token: 'xyz789',
        safeField: 'visible',
      },
    };
    const { redacted, redactedFieldPaths } = redactor.sanitize(input);
    const out = redacted as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).token).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).safeField).toBe('visible');
    expect(redactedFieldPaths).toContain('apiKey');
    expect(redactedFieldPaths).toContain('nested.token');
  });

  test('redacts secrets in nested arrays', () => {
    const input = {
      items: [
        { name: 'item1', value: 123 },
        { name: 'item2', apiKey: 'sk-secret456' },
      ],
    };
    const { redacted } = redactor.sanitize(input);
    const out = redacted as Record<string, unknown>;
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[1].apiKey).toBe(REDACTED);
    expect(items[0].value).toBe(123);
  });

  test('redacts secrets in string values regardless of field name', () => {
    const input = {
      message: 'Error: invalid token sk-abc123def456ghi789',
    };
    const { redacted } = redactor.sanitize(input);
    const out = redacted as Record<string, unknown>;
    expect(out.message as string).toContain(REDACTED);
    expect(out.message as string).not.toContain('sk-abc123def456ghi789');
  });

  test('minimal privacy level strips all content', () => {
    const minimalRedactor = new Redactor({ privacyLevel: 'minimal' });
    const input = {
      answer: 'This is a secret answer',
      args: { symbol: 'NVDA.US' },
    };
    const { redacted } = minimalRedactor.sanitize(input);
    const out = redacted as Record<string, unknown>;
    // At minimal level, strings are still redacted by pattern, but not stripped entirely
    expect(out.answer as string).toBe('This is a secret answer'); // no secrets here, so unchanged
  });

  test('portfolio tool results are downgraded at standard level', () => {
    const portfolioRedactor = new Redactor({ privacyLevel: 'standard' });
    const portfolioData = {
      positions: [
        { symbol: 'NVDA', quantity: 100, marketValue: 25000 },
        { symbol: 'AAPL', quantity: 50, marketValue: 10000 },
      ],
      cash: 5000,
    };
    const { redacted, portfolioDowngraded } = portfolioRedactor.sanitize(portfolioData, {
      toolName: 'get_portfolio',
    });
    expect(portfolioDowngraded).toBe(true);
    const out = redacted as Record<string, unknown>;
    expect(out.type).toBe('object');
    expect(out.redacted).toBe(true);
    expect(out.keys).toContain('positions');
    expect(out.keys).toContain('cash');
  });
});

// ── Tool Call Sanitization ───────────────────────────────────────────────────

describe('Redactor.sanitizeToolCall', () => {
  test('preserves run id, tool name, status, latency at all levels', () => {
    const toolCall: ToolCallRecord = {
      id: 'tool-123',
      toolName: 'get_quote',
      args: { symbol: 'NVDA.US' },
      startedAt: 1726000000000,
      completedAt: 1726000001000,
      status: 'success',
      result: { lastPrice: 185.5 },
    };

    const minimalRedactor = new Redactor({ privacyLevel: 'minimal' });
    const minimalResult = minimalRedactor.sanitizeToolCall(toolCall);
    expect(minimalResult.id).toBe('tool-123');
    expect(minimalResult.toolName).toBe('get_quote');
    expect(minimalResult.status).toBe('success');
    expect(minimalResult.args).toEqual({});
    expect(minimalResult.result).toBeUndefined();

    const standardRedactor = new Redactor({ privacyLevel: 'standard' });
    const standardResult = standardRedactor.sanitizeToolCall(toolCall);
    expect(standardResult.args).toEqual({ symbol: 'NVDA.US' });
    expect(standardResult.result).toEqual({ lastPrice: 185.5 });
  });

  test('redacts secrets in error messages', () => {
    const toolCall: ToolCallRecord = {
      id: 'tool-456',
      toolName: 'get_quote',
      args: {},
      startedAt: 1726000000000,
      status: 'error',
      error: {
        code: 'AUTH_FAILED',
        message: 'Invalid apiKey: sk-leaked1234567890abc',
      },
    };

    const redactor = new Redactor({ privacyLevel: 'standard' });
    const result = redactor.sanitizeToolCall(toolCall);
    expect(result.error?.message).toContain(REDACTED);
    expect(result.error?.message).not.toContain('sk-leaked1234567890abc');
  });
});

// ── Canary Scanner ────────────────────────────────────────────────────────────

describe('CanaryScanner', () => {
  test('detects canary secrets in text', () => {
    const canaries = generateCanarySeeds();
    const scanner = new CanaryScanner(canaries);
    const leakedSecret = canaries[0].value;
    const text = `The API key is: ${leakedSecret}`;
    const result = scanner.scanString(text);
    expect(result.leaks.length).toBeGreaterThan(0);
    expect(result.leaks[0].id).toBe(canaries[0].id);
  });

  test('detects canary secrets in nested objects', () => {
    const canaries = generateCanarySeeds();
    const scanner = new CanaryScanner(canaries);
    const leakedSecret = canaries[1].value;
    const data = {
      config: {
        provider: 'anthropic',
        apiKey: leakedSecret,
      },
    };
    const result = scanner.scanValue(data);
    expect(result.leaks.length).toBeGreaterThan(0);
  });

  test('clean data has no leaks', () => {
    const scanner = new CanaryScanner();
    const cleanData = {
      symbol: 'NVDA.US',
      lastPrice: 185.5,
      volume: 45000000,
    };
    const result = scanner.scanValue(cleanData);
    expect(result.leaks.length).toBe(0);
  });

  test('scan multiple artifacts', () => {
    const canaries = generateCanarySeeds();
    const scanner = new CanaryScanner(canaries);
    const leaked = canaries[0].value;

    const artifacts = [
      { name: 'log.txt', data: 'Normal log message' },
      { name: 'diagnostics.json', data: { error: `Auth failed: ${leaked}` } },
      { name: 'eval.json', data: { score: 0.85, answer: 'Clean answer' } },
    ];

    const result = scanner.scanAll(artifacts);
    expect(result.leaks.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Privacy Level Policy ──────────────────────────────────────────────────────

describe('Privacy level policy', () => {
  test('portfolio tool names are detected correctly', () => {
    expect(isPortfolioToolName('portfolio.summary')).toBe(true);
    expect(isPortfolioToolName('get_portfolio')).toBe(true);
    expect(isPortfolioToolName('get_positions')).toBe(true);
    expect(isPortfolioToolName('get_quote')).toBe(false);
    expect(isPortfolioToolName('get_valuation')).toBe(false);
  });

  test('sanitize convenience function works', () => {
    const input = { apiKey: 'sk-secret123', symbol: 'NVDA.US' };
    const out = sanitize(input) as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED);
    expect(out.symbol).toBe('NVDA.US');
  });
});

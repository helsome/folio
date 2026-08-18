import { describe, expect, it } from 'bun:test';
import { EvaluationRedactor } from './redactor.ts';

const LSV2_KEY =
  'lsv2_sk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const BEARER_TOKEN = 'abcdefghijklmnopqrstuvwxyz123456';

function toolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    toolName: 'market.quote',
    args: { symbol: 'AAPL' },
    startedAt: 10,
    completedAt: 20,
    status: 'success' as const,
    ...overrides,
  };
}

describe('EvaluationRedactor minimal', () => {
  it('keeps names/status/timings, drops args and result', () => {
    const r = new EvaluationRedactor('minimal');
    const call = r.redactToolCall(
      toolCall({ result: { price: 432.1 }, trace: [{ id: 'e1', type: 'tool_call', timestamp: 1 }] })
    );
    expect(call).toStrictEqual({
      id: 't1',
      toolName: 'market.quote',
      args: {},
      startedAt: 10,
      completedAt: 20,
      status: 'success',
      error: undefined,
    });
    expect(call).not.toHaveProperty('result');
    expect(call).not.toHaveProperty('trace');
  });

  it('keeps error status but no args for failed calls', () => {
    const r = new EvaluationRedactor('minimal');
    const call = r.redactToolCall(
      toolCall({
        status: 'error',
        error: { code: 'ERR', message: 'boom' },
        args: { apiKey: 'sk-abcdef1234567890xyz' },
      })
    );
    expect(call.status).toBe('error');
    expect(call.error).toEqual({ code: 'ERR', message: 'boom' });
    expect(call.args).toEqual({});
  });

  it('drops answers entirely', () => {
    expect(new EvaluationRedactor('minimal').redactAnswer('sell everything now')).toBeUndefined();
    expect(new EvaluationRedactor('minimal').redactAnswer(undefined)).toBeUndefined();
  });
});

describe('EvaluationRedactor standard', () => {
  it('redacts secret fields but preserves non-portfolio structure', () => {
    const r = new EvaluationRedactor('standard');
    const call = r.redactToolCall(
      toolCall({
        args: { symbol: 'AAPL', apiKey: 'sk-abcdef1234567890xyz', nested: { secret: 'hunter2' } },
        result: { price: 432.1, ok: true },
      })
    );
    expect(call.args).toEqual({ symbol: 'AAPL', apiKey: '[REDACTED]', nested: { secret: '[REDACTED]' } });
    expect(call.result).toEqual({ price: 432.1, ok: true });
  });

  it('reduces portfolio tool args and result to schema summaries (spec §60)', () => {
    const r = new EvaluationRedactor('standard');
    const call = r.redactToolCall(
      toolCall({
        toolName: 'portfolio.summary',
        args: { accountId: 'acc-7' },
        result: { holdings: [{ symbol: 'AAPL', qty: 10 }], cash: 123456.78 },
      })
    );
    expect(call.args).toEqual({ type: 'object', keys: ['accountId'], redacted: true });
    expect(call.result).toEqual({ type: 'object', keys: ['holdings', 'cash'], redacted: true });
  });

  it('summarizes portfolio array payloads by length only', () => {
    const r = new EvaluationRedactor('standard');
    const call = r.redactToolCall(
      toolCall({ toolName: 'portfolio.positions', args: {}, result: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }] })
    );
    expect(call.result).toEqual({ type: 'array', length: 2, redacted: true });
  });

  it('redacts answers via the text redactor', () => {
    const r = new EvaluationRedactor('standard');
    expect(r.redactAnswer(`authorization Bearer ${BEARER_TOKEN}`)).toBe('authorization Bearer [REDACTED]');
  });
});

describe('EvaluationRedactor full', () => {
  it('keeps the full payload, credentials still redacted', () => {
    const r = new EvaluationRedactor('full');
    const call = r.redactToolCall(
      toolCall({
        toolName: 'portfolio.summary',
        args: { accountId: 'acc-7' },
        result: { holdings: [{ symbol: 'AAPL', qty: 10 }], cash: 123456.78 },
      })
    );
    expect(call.args).toEqual({ accountId: 'acc-7' });
    expect(call.result).toEqual({ holdings: [{ symbol: 'AAPL', qty: 10 }], cash: 123456.78 });
  });

  it('still redacts credentials inside payloads at full', () => {
    const r = new EvaluationRedactor('full');
    const redacted = r.redactValue({
      settings: { apiKey: LSV2_KEY },
      note: `Bearer ${BEARER_TOKEN}`,
    }).redacted as Record<string, unknown>;
    expect((redacted.settings as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(redacted.note).not.toContain(BEARER_TOKEN);
  });
});

describe('credential redaction at every level', () => {
  it('redacts lsv2 keys, apiKey fields, and bearer tokens at minimal/standard/full', () => {
    for (const level of ['minimal', 'standard', 'full'] as const) {
      const r = new EvaluationRedactor(level);
      const { redacted, redactedFieldPaths } = r.redactValue({
        apiKey: LSV2_KEY,
        headers: { authorization: `Bearer ${BEARER_TOKEN}` },
        note: `token ghp_${BEARER_TOKEN} and eyJhbGciOiJIUzI1NiJ9.9876543210.signaturehere and Bearer ${BEARER_TOKEN}`,
        plain: 'keep me',
      });
      const out = redacted as Record<string, unknown>;
      expect(out.apiKey).toBe('[REDACTED]');
      expect((out.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
      expect(out.note).not.toContain('ghp_');
      expect(out.note).not.toContain('9876543210');
      expect(out.note).not.toContain(BEARER_TOKEN);
      expect(out.plain).toBe('keep me');
      expect(redactedFieldPaths).toEqual(expect.arrayContaining(['apiKey', 'headers.authorization']));
    }
  });

  it('redacts nested a.b.apiKey and records the field path', () => {
    const r = new EvaluationRedactor('standard');
    const { redacted, redactedFieldPaths } = r.redactValue({
      a: { b: { apiKey: 'sk-abcdef1234567890xyz', keep: 1 }, keep2: 'x' },
    }) as { redacted: Record<string, unknown>; redactedFieldPaths: string[] };
    const a = redacted.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    expect(b.apiKey).toBe('[REDACTED]');
    expect(b.keep).toBe(1);
    expect(a.keep2).toBe('x');
    expect(redactedFieldPaths).toEqual(['a.b.apiKey']);
  });

  it('redacts array elements with indexed paths', () => {
    const r = new EvaluationRedactor('standard');
    const { redacted, redactedFieldPaths } = r.redactValue({
      items: [{ ok: 1 }, { token: 'abc' }],
    });
    const out = redacted as Record<string, unknown>;
    expect(out.items).toEqual([{ ok: 1 }, { token: '[REDACTED]' }]);
    expect(redactedFieldPaths).toEqual(['items[1].token']);
  });
});

describe('portfolio downgrade placement', () => {
  it('applies the portfolio rule only through redactToolCall, not the public redactValue', () => {
    // redactValue has no tool-result context, so the spec §60 downgrade is the
    // responsibility of redactToolCall; the public API keeps structure intact.
    const r = new EvaluationRedactor('standard');
    const { redacted, portfolioDowngraded } = r.redactValue({
      'portfolio.summary': { holdings: [{ symbol: 'AAPL' }] },
    }) as { redacted: Record<string, unknown>; portfolioDowngraded: boolean };
    expect(portfolioDowngraded).toBe(false);
    expect(redacted).toEqual({ 'portfolio.summary': { holdings: [{ symbol: 'AAPL' }] } });
  });
});
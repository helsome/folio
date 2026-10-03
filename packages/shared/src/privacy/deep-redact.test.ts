import { describe, expect, it } from 'bun:test';
import { deepRedact, redactError } from './deep-redact.ts';

describe('deepRedact', () => {
  it('redacts secret fields at any nesting depth in tool args/results', () => {
    const toolArgs = {
      symbol: 'AAPL.US',
      auth: {
        apiKey: 'sk-abcdef1234567890',
      },
      request: {
        headers: {
          Authorization: 'Bearer abcdefghijklmnop123456',
          'x-api-key': 'rawkey987654321',
        },
      },
      options: [{ refresh_token: 'tokenabcdef123456' }, { limit: 10 }],
    };
    const { value } = deepRedact(toolArgs);
    const out = value as typeof toolArgs;
    // `auth` itself is a secret field name — the whole subtree goes.
    expect(out.auth as unknown).toBe('[REDACTED]');
    expect(out.request.headers.Authorization).toBe('[REDACTED]');
    expect(out.request.headers['x-api-key']).toBe('[REDACTED]');
    expect(out.options[0].refresh_token).toBe('[REDACTED]');
    // Non-secret content is preserved.
    expect(out.symbol).toBe('AAPL.US');
    expect(out.options[1].limit).toBe(10);
  });

  it('redacts secret-shaped text inside nested values (URL query, keys)', () => {
    const payload = {
      request: { url: 'https://api.example.com/v1?symbol=AAPL&apikey=abcdef123456789' },
      note: 'provider said: sk-abcdef1234567890 rejected',
    };
    const { value } = deepRedact(payload);
    const out = value as typeof payload;
    expect(out.request.url).toContain('symbol=AAPL');
    expect(out.request.url).not.toContain('abcdef123456789');
    expect(out.note).not.toContain('sk-abcdef1234567890');
  });

  it('keeps observability fields intact (run id, tool name, latency, status)', () => {
    const trace = {
      runId: '1a2b3c4d-5678-4ef0-ab12-cd34ef56ab78',
      threadId: 'sess_1a2b3c4d5e6f7g8h',
      toolName: 'market.quote',
      status: 'completed',
      latencyMs: 1234,
      startedAt: 1726000000000,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    };
    const { value, redactedPaths } = deepRedact(trace);
    expect(value).toEqual(trace);
    expect(redactedPaths).toEqual([]);
  });

  it('fail-closed: cyclic structures become REDACTED instead of throwing', () => {
    const cyclic: Record<string, unknown> = { apiKey: 'sk-abcdef1234567890' };
    cyclic.self = cyclic;
    const { value } = deepRedact(cyclic);
    const out = value as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.self).toBe('[REDACTED]');
  });

  it('fail-closed: over-deep structures are cut off with REDACTED', () => {
    let deep: unknown = { secret: 'x' };
    for (let i = 0; i < 60; i += 1) deep = { nested: deep };
    expect(() => deepRedact(deep)).not.toThrow();
    const { value } = deepRedact(deep);
    expect(JSON.stringify(value)).toContain('[REDACTED]');
    expect(JSON.stringify(value)).not.toContain('"secret":"x"');
  });

  it('reports redacted field paths without values', () => {
    const { redactedPaths } = deepRedact({ a: { client_secret: 'supersecret123' } });
    expect(redactedPaths).toContain('a.client_secret');
  });

  it('never mutates the input', () => {
    const input = { apiKey: 'sk-abcdef1234567890', url: 'https://x.io?token=abcdefgh1234' };
    const snapshot = JSON.stringify(input);
    deepRedact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('redactError', () => {
  it('redacts message and stack of a thrown error', () => {
    const error = new Error('Request failed: Authorization: Bearer abcdefghijklmnop123');
    error.stack = `${error.name}: ${error.message}\n    at fetch (client.ts:1:1)`;
    const out = redactError(error);
    expect(out.message).not.toContain('abcdefghijklmnop123');
    expect(out.message).toContain('[REDACTED]');
    expect(out.stack).not.toContain('abcdefghijklmnop123');
    expect(out.stack).toContain('at fetch (client.ts:1:1)');
  });

  it('handles non-Error throwables', () => {
    const out = redactError('401: bad api_key=supersecretvalue99');
    expect(out.message).not.toContain('supersecretvalue99');
    expect(out.stack).toBeNull();
  });

  it('is fail-closed on exotic inputs', () => {
    // A toString that throws exercises the fail-closed path.
    const hostile = {
      toString(): string {
        throw new Error('boom');
      },
    };
    const out = redactError(hostile);
    expect(out.message).toBe('[REDACTED]');
    expect(out.stack).toBeNull();
  });
});

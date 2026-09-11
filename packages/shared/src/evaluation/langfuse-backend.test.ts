import { describe, test, expect } from 'bun:test';
import {
  LangfuseEvaluationBackend,
  resolveLangfuseBackend,
} from './langfuse-backend.ts';
import { NoopEvaluationBackend } from './backend.ts';

// ── Fake fetch helper ──────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function makeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetchImpl = async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const status = responses[idx]?.status ?? 200;
    const body = responses[idx]?.body ?? {};
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    idx++;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LangfuseEvaluationBackend', () => {
  test('status() returns connected on 200', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, body: { status: 'OK' } }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    const status = await backend.status();
    expect(status.available).toBe(true);
    expect(status.kind).toBe('langfuse');
  });

  test('status() returns unavailable on error', async () => {
    const { fetchImpl } = makeFetch([{ status: 401 }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    const status = await backend.status();
    expect(status.available).toBe(false);
  });

  test('uses Basic Auth with public:secret key', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200 }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    await backend.status();
    expect(calls[0].headers.authorization).toBeDefined();
    expect(calls[0].headers.authorization).toContain('Basic ');
  });

  test('findTraces() returns empty array on failure', async () => {
    const { fetchImpl } = makeFetch([{ status: 500 }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    const traces = await backend.findTraces({ startedAfter: 1000, startedBefore: 2000 });
    expect(traces).toEqual([]);
  });

  test('traceUrl() constructs correct URL', () => {
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      host: 'https://cloud.langfuse.com',
    });
    const url = backend.traceUrl('trace-123');
    expect(url).toBe('https://cloud.langfuse.com/trace/trace-123');
  });

  test('sendTraceBatch() sends ingestion request', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200 }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    await backend.sendTraceBatch({
      id: 'trace-456',
      timestamp: new Date().toISOString(),
      name: 'Test Run',
      sessionId: 'session-123',
      input: 'What is NVDA PE?',
      output: 'NVDA PE is 65x',
      public: false,
    });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/api/public/ingestion');
    expect(calls[0].body).toContain('trace-create');
  });

  test('addScore() sends score request', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200 }]);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchImpl,
    });
    await backend.addScore('trace-789', 'groundedness', 0.85, 'Good answer');
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/api/public/scores');
    expect(calls[0].body).toContain('groundedness');
    expect(calls[0].body).toContain('0.85');
  });
});

describe('resolveLangfuseBackend', () => {
  test('returns Noop when tracing disabled', () => {
    const backend = resolveLangfuseBackend(
      { tracingEnabled: false, traceBackend: 'langfuse' },
      { langfusePublicKey: 'pk', langfuseSecretKey: 'sk' }
    );
    expect(backend.kind).toBe('none');
  });

  test('returns Noop when backend is langsmith', () => {
    const backend = resolveLangfuseBackend(
      { tracingEnabled: true, traceBackend: 'langsmith' },
      { langfusePublicKey: 'pk', langfuseSecretKey: 'sk' }
    );
    expect(backend.kind).toBe('none');
  });

  test('returns Noop when credentials missing', () => {
    const backend = resolveLangfuseBackend(
      { tracingEnabled: true, traceBackend: 'langfuse' },
      {}
    );
    expect(backend.kind).toBe('none');
  });

  test('returns Langfuse backend when configured correctly', () => {
    const backend = resolveLangfuseBackend(
      { tracingEnabled: true, traceBackend: 'langfuse' },
      { langfusePublicKey: 'pk', langfuseSecretKey: 'sk' }
    );
    expect(backend.kind).toBe('langfuse');
  });
});

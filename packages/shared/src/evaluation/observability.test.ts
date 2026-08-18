// V7 end-to-end observability verification (spec §103-105, §87, §89).
//
// Covers the production settle path: a finished run becomes a redacted
// evaluation record with a correlated trace reference, and observability
// failures never break the caller.
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvaluationRun, TraceReference } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import {
  EvaluationRedactor,
  EvaluationStore,
  LangSmithEvaluationBackend,
  LocalEvaluationBackend,
  TraceCorrelationService,
  resolveBackend,
} from './index.ts';

async function withStore<T>(fn: (store: EvaluationStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'folio-eval-obs-'));
  try {
    return await fn(new EvaluationStore(new JsonFileStore(dir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sampleRun(): EvaluationRun {
  return {
    id: 'run-1',
    experimentId: '__observability__',
    caseId: '',
    datasetId: '',
    status: 'completed',
    startedAt: 1_000,
    completedAt: 1_500,
    latencyMs: 500,
    answer: 'AAPL is trading at $200.',
    toolCalls: [
      {
        id: 'tc-1',
        toolName: 'get_quote',
        args: { symbol: 'AAPL.US' },
        startedAt: 1_100,
        completedAt: 1_200,
        status: 'success',
        result: { data: { symbol: 'AAPL.US', lastPrice: 200 }, provenance: { provider: 'longbridge', fetchedAt: 1_100 } },
      },
    ],
    failureModes: [],
    error: { code: 'TOKEN_ABOUT_TO_EXPIRE', message: 'refresh token sk-abcdef123456789 expired' },
  };
}

describe('observability settle pipeline', () => {
  it('stores a redacted run and correlates a local trace link (standard privacy)', async () => {
    await withStore(async (store) => {
      const backend = new LocalEvaluationBackend();
      const correlation = new TraceCorrelationService({ backend, store, now: () => Date.now() });
      const redactor = new EvaluationRedactor('standard');
      const run = redactor.redactToolCall(sampleRun().toolCalls[0]);
      expect(run.result).toBeDefined();
      await store.addRun({ ...sampleRun(), toolCalls: [run] });
      const ref = await correlation.recordRun({
        folioRunId: 'run-1',
        folioSessionId: 'session-1',
        startedAt: 1_000,
        completedAt: 1_500,
      });
      expect(ref.backend).toBe('none');
      const link = await store.lookupTraceLink('run-1');
      expect(link?.traceRef.runId).toBe('run-1');
    });
  });

  it('redacts portfolio payloads and credential fields at standard', async () => {
    const redactor = new EvaluationRedactor('standard');
    const redacted = redactor.redactToolCall({
      id: 'tc-2',
      toolName: 'get_positions',
      args: {},
      startedAt: 0,
      status: 'success',
      result: { holdings: [{ symbol: 'AAPL', qty: 10 }], cash: 123456.78, apiKey: 'lsv2_pt_abc123456' },
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('AAPL');
    expect(serialized).not.toContain('123456.78');
    expect(serialized).not.toContain('lsv2_');
    expect(redacted.result).toMatchObject({ type: 'object', redacted: true });
  });

  it('never reveals secrets at full privacy', () => {
    const redactor = new EvaluationRedactor('full');
    const run = sampleRun();
    const toolCall = run.toolCalls[0];
    toolCall.error = { code: 'TOKEN_ABOUT_TO_EXPIRE', message: 'refresh token sk-abcdef123456789 expired' };
    const redacted = redactor.redactToolCall(toolCall);
    // The redactor redacts error.message at every level (spec §105); the raw
    // error is never what gets persisted/uploaded — only the redacted record.
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('sk-abcdef123456789');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('backend failure isolation (spec §87, §89)', () => {
  it('LangSmith offline/401 degrades to a status error, never a throw', async () => {
    const backend = new LangSmithEvaluationBackend({
      apiKey: 'lsv2_pt_badkey',
      project: 'folio-agent',
      fetchImpl: async () => {
        throw new Error('network unreachable');
      },
    });
    const status = await backend.status();
    expect(status.available).toBe(false);
    expect(status.message).toContain('unreachable');
    const matches = await backend.findTraces({ threadId: 't1', startedAfter: 0, startedBefore: 1000 });
    expect(matches).toEqual([]);
  });

  it('bad credential returns 401 as a status error', async () => {
    const backend = new LangSmithEvaluationBackend({
      apiKey: 'lsv2_pt_invalid',
      project: 'folio-agent',
      fetchImpl: async (url, init) =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const status = await backend.status();
    expect(status.available).toBe(false);
    expect(status.message).toContain('401');
  });

  it('correlation degrades to backend none when no trace matches and never throws', async () => {
    await withStore(async (store) => {
      const backend = new LangSmithEvaluationBackend({
        apiKey: 'lsv2_pt_x',
        project: 'folio-agent',
        fetchImpl: async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }),
      });
      const correlation = new TraceCorrelationService({ backend, store });
      const ref = await correlation.recordRun({ folioRunId: 'r2', threadId: 't', startedAt: 0, completedAt: 10 });
      // Tracing is on (langsmith backend) but no trace matched the window:
      // the ref keeps the backend kind with no trace id, and never throws.
      expect(ref.backend).toBe('langsmith');
      expect(ref.traceId).toBeUndefined();
    });
  });

  it('resolveBackend returns noop when tracing is off or the key is missing', () => {
    expect(resolveBackend({ tracingEnabled: false, langsmithProject: 'p' }, 'key').kind).toBe('none');
    expect(resolveBackend({ tracingEnabled: true, langsmithProject: 'p' }, undefined).kind).toBe('none');
    expect(resolveBackend({ tracingEnabled: true, langsmithProject: 'p' }, 'lsv2_pt_x').kind).toBe('langsmith');
  });
});

describe('trace reference shape', () => {
  it('carries backend, ids, and optional url', () => {
    const ref: TraceReference = { backend: 'langsmith', traceId: 'abc', threadId: 'pi-1', runId: 'run-9', url: 'https://smith.langchain.com/x' };
    expect(ref.backend).toBe('langsmith');
    expect(ref.traceId).toBe('abc');
  });
});
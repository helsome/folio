import { afterAll, describe, expect, it } from 'bun:test';
import type { EvaluationScore, ResearchReport } from '@finagent/core';
import { NoopEvaluationBackend } from '../backend.ts';
import { TraceCorrelationService } from '../correlation.ts';
import { EvaluationStore } from '../store.ts';
import { JsonFileStore } from '../../storage/json-file-store.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LangfuseEvaluationBackend,
  buildAgentTraceBatch,
  buildResearchTraceBatch,
  isLangfuseTracingEnabled,
  langfuseTags,
  parseLangfuseCredential,
  resolveLangfuseBackend,
  scoresFromEvaluation,
  scoresFromResearchReport,
  scoresFromAgentRun,
  serializeLangfuseCredential,
} from './index.ts';

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

async function startMock(options?: { failIngest?: boolean; failHealth?: boolean; hang?: boolean }) {
  const captured: CapturedRequest[] = [];
  const traces: Array<{ id: string; sessionId?: string; metadata?: Record<string, unknown>; timestamp: string }> = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const bodyText = request.method === 'GET' ? '' : await request.text();
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      captured.push({ method: request.method, path: url.pathname, body });
      if (options?.hang) {
        await new Promise(() => undefined);
      }
      if (url.pathname === '/api/public/projects') {
        if (options?.failHealth) return new Response('nope', { status: 503 });
        return Response.json({ data: [{ id: 'proj' }] });
      }
      if (url.pathname === '/api/public/ingestion') {
        if (options?.failIngest) return new Response('ingest failed', { status: 500 });
        const batch = (body as { batch?: Array<{ type: string; body: Record<string, unknown> }> }).batch ?? [];
        for (const event of batch) {
          if (event.type === 'trace-create' && typeof event.body.id === 'string') {
            traces.push({
              id: event.body.id,
              sessionId: typeof event.body.sessionId === 'string' ? event.body.sessionId : undefined,
              metadata: (event.body.metadata as Record<string, unknown> | undefined) ?? {},
              timestamp: typeof event.body.timestamp === 'string' ? event.body.timestamp : new Date().toISOString(),
            });
          }
        }
        return Response.json({ successes: batch.map((event) => ({ id: event.body.id })), errors: [] });
      }
      if (url.pathname === '/api/public/traces') {
        return Response.json({ data: traces });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    captured,
    traces,
    host: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

function agentSnapshot() {
  return {
    folioRunId: 'run-agent-1',
    sessionId: 'session-1',
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_500,
    input: 'What is AAPL last price?',
    output: 'AAPL last is 200.',
    toolCalls: [
      {
        id: 'tc-1',
        toolName: 'get_quote',
        args: { symbol: 'AAPL.US' },
        startedAt: 1_700_000_000_200,
        completedAt: 1_700_000_000_400,
        status: 'success' as const,
        result: { lastPrice: 200 },
      },
      {
        id: 'tc-2',
        toolName: 'get_news',
        args: { symbol: 'AAPL.US' },
        startedAt: 1_700_000_000_500,
        completedAt: 1_700_000_000_800,
        status: 'success' as const,
        result: [{ title: 'Earnings' }],
      },
    ],
    model: 'local/deterministic',
    provider: 'local',
    usage: { input: 12, output: 40, total: 52 },
    metadata: {
      folioRunId: 'run-agent-1',
      folioSessionId: 'session-1',
      runKind: 'evaluation' as const,
      goldCaseId: 'gold-quote-1',
      datasetId: 'deep-research-gold',
      datasetVersion: 'v1',
      model: 'local/deterministic',
      agentVersion: '0.4.0-beta.2',
    },
  };
}

function researchSnapshot() {
  const report = {
    summary: 'NVDA remains well supported by data-center demand.',
    stance: 'bullish' as const,
    confidence: 0.72,
    sections: [
      {
        key: 'market.quote',
        title: 'Quote',
        verdict: 'positive' as const,
        summary: 'Last 120',
        evidence: [{ capabilityId: 'market.quote', runId: 'cap-1', claim: 'last', fetchedAt: 1 }],
      },
      {
        key: 'research.news',
        title: 'News',
        verdict: 'positive' as const,
        summary: 'Datacenter headlines',
        evidence: [{ capabilityId: 'research.news', runId: 'cap-2', claim: 'news', fetchedAt: 1 }],
      },
    ],
    bullCase: ['Demand'],
    bearCase: ['Valuation'],
    risks: ['Competition'],
    capabilityRuns: [
      { runId: 'cap-1', capabilityId: 'market.quote', status: 'success' as const },
      { runId: 'cap-2', capabilityId: 'research.news', status: 'success' as const },
    ],
    runStatus: 'completed' as const,
  } satisfies Pick<
    ResearchReport,
    'summary' | 'stance' | 'confidence' | 'sections' | 'bullCase' | 'bearCase' | 'risks' | 'capabilityRuns' | 'runStatus'
  >;
  return {
    folioRunId: 'research-NVDA_US-1',
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_004_000,
    symbol: 'NVDA.US',
    strategyId: 'comprehensive',
    query: 'Deep research NVDA.US',
    capabilities: [
      {
        capabilityId: 'market.quote',
        status: 'success',
        startedAt: 1_700_000_000_100,
        finishedAt: 1_700_000_000_300,
        summary: 'NVDA 120',
        provider: 'longbridge',
      },
      {
        capabilityId: 'research.news',
        status: 'success',
        startedAt: 1_700_000_000_200,
        finishedAt: 1_700_000_000_800,
        summary: '2 headlines',
        provider: 'longbridge',
      },
    ],
    report,
    model: 'local-synthesizer',
    provider: 'local',
    metadata: {
      folioRunId: 'research-NVDA_US-1',
      runKind: 'normal' as const,
      folioVersion: '0.4.0-beta.2',
      symbol: 'NVDA.US',
    },
  };
}

describe('langfuse metadata', () => {
  it('emits filterable tags for evaluation gold cases', () => {
    const tags = langfuseTags({
      folioRunId: 'r1',
      runKind: 'evaluation',
      goldCaseId: 'gold-quote-1',
      datasetId: 'deep-research-gold',
      datasetVersion: 'v1',
      model: 'anthropic/claude-sonnet',
    });
    expect(tags).toContain('folio');
    expect(tags).toContain('run_kind:evaluation');
    expect(tags).toContain('gold_case:gold-quote-1');
    expect(tags).toContain('dataset:deep-research-gold@v1');
    expect(tags).toContain('model:anthropic/claude-sonnet');
  });

  it('parses stored JSON credentials and rejects secrets-in-git mistakes', () => {
    const blob = serializeLangfuseCredential('pk-lf-public', 'sk-lf-secret');
    expect(parseLangfuseCredential(blob)).toEqual({ publicKey: 'pk-lf-public', secretKey: 'sk-lf-secret' });
    expect(parseLangfuseCredential('pk-lf-public|sk-lf-secret')).toEqual({
      publicKey: 'pk-lf-public',
      secretKey: 'sk-lf-secret',
    });
    expect(parseLangfuseCredential('not-a-credential')).toBeUndefined();
  });
});

describe('langfuse exporter', () => {
  it('builds a multi-span agent trace, not a single LLM generation', () => {
    const batch = buildAgentTraceBatch(agentSnapshot());
    const types = batch.events.map((event) => `${event.type}:${String(event.body.name ?? '')}`);
    expect(types.some((entry) => entry.startsWith('trace-create:folio.agent_run'))).toBe(true);
    expect(types).toContain('span-create:tool.get_quote');
    expect(types).toContain('span-create:tool.get_news');
    expect(types).toContain('generation-create:agent.generation');
    const trace = batch.events.find((event) => event.type === 'trace-create');
    expect((trace?.body.tags as string[]) ?? []).toContain('gold_case:gold-quote-1');
    expect(trace?.body.input).toBe('What is AAPL last price?');
    expect(trace?.body.output).toBe('AAPL last is 200.');
  });

  it('builds a deep-research trace with retrieval spans plus synthesis and report', () => {
    const batch = buildResearchTraceBatch(researchSnapshot());
    const names = batch.events.map((event) => String(event.body.name ?? ''));
    expect(names).toContain('folio.deep_research');
    expect(names).toContain('research.input');
    expect(names).toContain('retrieval.market.quote');
    expect(names).toContain('retrieval.research.news');
    expect(names).toContain('research.synthesis');
    expect(names).toContain('research.report');
  });

  it('omits payloads at minimal privacy', () => {
    const batch = buildAgentTraceBatch(agentSnapshot(), 'minimal');
    for (const event of batch.events) {
      expect(event.body.input).toBeUndefined();
      expect(event.body.output).toBeUndefined();
    }
  });
});

describe('langfuse scores', () => {
  it('writes groundedness and citation coverage from a research report', () => {
    const scores = scoresFromResearchReport(researchSnapshot().report, undefined, 4000);
    const names = scores.map((score) => score.name);
    expect(names).toContain('groundedness');
    expect(names).toContain('citation_coverage');
    expect(names).toContain('tool_retrieval_success');
    expect(names).toContain('task_completion');
    expect(names).toContain('latency_ms');
    expect(scores.find((score) => score.name === 'citation_coverage')?.value).toBe(1);
  });

  it('maps evaluation scores including groundedness', () => {
    const input: EvaluationScore[] = [
      { metric: 'groundedness', metricVersion: '1.0.0', score: 0.8, reason: 'claims cited' },
      { metric: 'task_completion', metricVersion: '1.0.0', score: 1 },
    ];
    const mapped = scoresFromEvaluation(input);
    expect(mapped.some((score) => score.name === 'groundedness' && score.value === 0.8)).toBe(true);
    expect(mapped.some((score) => score.name === 'task_completion')).toBe(true);
  });

  it('writes tool success and completion scores for agent runs', () => {
    const scores = scoresFromAgentRun({
      completed: true,
      toolCalls: agentSnapshot().toolCalls,
      latencyMs: 1500,
    });
    expect(scores.some((score) => score.name === 'task_completion' && score.value === 1)).toBe(true);
    expect(scores.some((score) => score.name === 'tool_retrieval_success' && score.value === 1)).toBe(true);
    expect(scores.some((score) => score.name === 'latency_ms' && score.value === 1500)).toBe(true);
  });
});

describe('langfuse backend', () => {
  const servers: Array<{ stop: () => void }> = [];
  afterAll(() => {
    for (const server of servers) server.stop();
  });

  it('exports a research run and writes scores back to the same trace', async () => {
    const mock = await startMock();
    servers.push(mock);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      host: mock.host,
    });
    const ref = await backend.exportResearchRun(researchSnapshot());
    expect(ref.backend).toBe('langfuse');
    expect(ref.traceId).toBe('research-NVDA_US-1');
    const scores = scoresFromResearchReport(researchSnapshot().report, undefined, 4000);
    await backend.submitScores(ref.traceId!, scores);
    const ingestCalls = mock.captured.filter((entry) => entry.path === '/api/public/ingestion');
    expect(ingestCalls.length).toBeGreaterThanOrEqual(2);
    const second = ingestCalls[1]?.body as { batch?: Array<{ type: string; body: { name?: string; traceId?: string } }> };
    const scoreNames = (second.batch ?? []).filter((event) => event.type === 'score-create').map((event) => event.body.name);
    expect(scoreNames).toContain('groundedness');
    expect(scoreNames).toContain('citation_coverage');
    const matches = await backend.findTraces({ sessionId: undefined, startedAfter: 1_700_000_000_000 - 1000 });
    expect(matches.some((match) => match.traceId === ref.traceId)).toBe(true);
    const health = await backend.status();
    expect(health.available).toBe(true);
    expect(health.kind).toBe('langfuse');
  });

  it('does not throw when Langfuse is down — agent path keeps a diagnostic', async () => {
    const mock = await startMock({ failIngest: true, failHealth: true });
    servers.push(mock);
    const backend = new LangfuseEvaluationBackend({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      host: mock.host,
    });
    const ref = await backend.exportAgentRun(agentSnapshot());
    expect(ref.backend).toBe('langfuse');
    expect(ref.traceId).toBe('run-agent-1');
    expect(backend.lastErrorDetails).toContain('Langfuse API 500');
    const status = await backend.status();
    expect(status.available).toBe(false);
    await backend.submitScores('run-agent-1', [{ name: 'groundedness', value: 0.5 }]);
    expect(backend.lastErrorDetails).toBeDefined();
  });

  it('resolves to noop when tracing is off or credentials are missing', () => {
    expect(
      resolveLangfuseBackend({
        settings: { langfuseTracingEnabled: false, langfuseHost: '', privacyLevel: 'standard' },
        env: {},
      }).kind
    ).toBe('none');
    expect(
      resolveLangfuseBackend({
        settings: { langfuseTracingEnabled: true, langfuseHost: '', privacyLevel: 'standard' },
        env: {},
      }).kind
    ).toBe('none');
    expect(
      resolveLangfuseBackend({
        settings: { langfuseTracingEnabled: true, langfuseHost: 'http://localhost:9', privacyLevel: 'standard' },
        storedCredential: serializeLangfuseCredential('pk', 'sk'),
        env: {},
      }).kind
    ).toBe('langfuse');
    expect(isLangfuseTracingEnabled({ langfuseTracingEnabled: false }, { LANGFUSE_TRACING: 'true' })).toBe(true);
  });

  it('correlates an ingested Langfuse trace without treating it as LangSmith', async () => {
    const mock = await startMock();
    servers.push(mock);
    const dir = await mkdtemp(join(tmpdir(), 'folio-lf-corr-'));
    try {
      const store = new EvaluationStore(new JsonFileStore(dir));
      const backend = new LangfuseEvaluationBackend({
        publicKey: 'pk',
        secretKey: 'sk',
        host: mock.host,
      });
      await backend.exportAgentRun(agentSnapshot());
      const correlation = new TraceCorrelationService({ backend, store, now: () => 1_700_000_001_500 });
      const ref = await correlation.recordRun({
        folioRunId: 'run-agent-1',
        folioSessionId: 'session-1',
        startedAt: 1_700_000_000_000,
        completedAt: 1_700_000_001_500,
      });
      expect(ref.backend).toBe('langfuse');
      expect(ref.traceId).toBe('run-agent-1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a Noop backend typed as EvaluationBackend', () => {
    const backend = new NoopEvaluationBackend();
    expect(backend.kind).toBe('none');
  });
});

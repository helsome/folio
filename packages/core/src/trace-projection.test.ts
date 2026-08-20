import { describe, expect, it } from 'bun:test';
import { projectTrace, type TraceProjectionInput } from './trace-projection.ts';
import type {
  EvaluationCase,
  EvaluationRun,
  EvaluationResultRecord,
  Message,
  Run,
} from './index.ts';

const baseRun: Run = {
  id: 'run-1',
  sessionId: 'session-1',
  status: 'completed',
  input: 'What about NVDA?',
  startedAt: 1000,
  completedAt: 19000,
  answer: 'NVDA is attractive.',
};

const assistantWithCalls: Message = {
  id: 'm-2',
  role: 'assistant',
  content: 'NVDA is attractive.',
  timestamp: 18000,
  toolCalls: [
    {
      id: 'tc-1',
      toolName: 'get_quote',
      args: { symbol: 'NVDA.US' },
      startedAt: 2000,
      completedAt: 3000,
      status: 'success',
      result: { lastPrice: 120 },
    },
    {
      id: 'tc-2',
      toolName: 'get_financials',
      args: { symbol: 'NVDA.US' },
      startedAt: 4000,
      completedAt: 5000,
      status: 'success',
      result: { revenue: 1e10 },
    },
  ],
};

function inputWith(extra: Partial<TraceProjectionInput>): TraceProjectionInput {
  return { run: baseRun, messages: [assistantWithCalls], ...extra };
}

describe('projectTrace (V9.1)', () => {
  it('never fabricates workspace context for a session run', () => {
    const trace = projectTrace(inputWith({}));
    expect(trace.context).toHaveLength(2); // session + workspace not-recorded
    const ws = trace.context.find((c) => c.key === 'workspace');
    expect(ws?.source).toBe('not-recorded');
    expect(ws?.value).toBe('');
  });

  it('marks evaluation-case context as evaluation-input, not recorded', () => {
    const caseDef: EvaluationCase = {
      id: 'case-1',
      name: 'NVDA research',
      category: 'tool-selection',
      difficulty: 'golden',
      input: {
        prompt: 'Research NVDA',
        workspaceContext: { activeSymbol: 'NVDA.US' },
        strategyId: 'growth',
        model: 'deepseek-v3',
      },
      expected: { requiredCapabilities: ['market.quote', 'company.financials'] },
      tags: [],
      source: 'hand-authored',
    };
    const trace = projectTrace(inputWith({ evaluationCase: caseDef }));
    const ws = trace.context.find((c) => c.key === 'workspace');
    expect(ws?.source).toBe('evaluation-input');
    expect(ws?.value).toBe('NVDA.US');
    const strategy = trace.context.find((c) => c.key === 'strategy');
    expect(strategy?.value).toBe('growth');
  });

  it('keeps evaluation findings separate from the execution timeline', () => {
    const caseDef: EvaluationCase = {
      id: 'case-1',
      name: 'NVDA research',
      category: 'tool-selection',
      difficulty: 'golden',
      input: { prompt: 'Research NVDA', workspaceContext: { activeSymbol: 'NVDA.US' } },
      expected: {
        requiredCapabilities: ['market.quote', 'company.financials', 'research.news'],
      },
      tags: [],
      source: 'hand-authored',
    };
    const evalRun: EvaluationRun = {
      id: 'eval-run-1',
      experimentId: 'exp-1',
      caseId: 'case-1',
      datasetId: 'ds-1',
      status: 'completed',
      startedAt: 1000,
      completedAt: 9000,
      latencyMs: 8000,
      answer: 'NVDA looks fine',
      toolCalls: [
        {
          id: 'e1',
          toolName: 'get_quote',
          args: {},
          startedAt: 2000,
          completedAt: 3000,
          status: 'success',
        },
        {
          id: 'e2',
          toolName: 'get_financials',
          args: {},
          startedAt: 4000,
          completedAt: 5000,
          status: 'success',
        },
      ],
      failureModes: ['missing_tool'],
    };
    const result: EvaluationResultRecord = {
      id: 'r-1',
      runId: 'eval-run-1',
      experimentId: 'exp-1',
      caseId: 'case-1',
      scores: [{ metric: 'tool_recall', metricVersion: '1.0', score: 0.67 }],
      failureModes: ['missing_tool'],
      verdict: 'fail',
      notes: 'Expected news capability was missing',
    };
    const trace = projectTrace(inputWith({ evaluationRun: evalRun, evaluationResult: result, evaluationCase: caseDef }));

    // Finding says "Financials..." — the missing tool is IN the finding, not the timeline.
    expect(trace.evaluation?.verdict).toBe('fail');
    expect(trace.evaluation?.failureMode).toBe('missing_tool');
    expect(trace.evaluation?.expected).toContain('research.news');
    expect(trace.evaluation?.actual).toEqual(['get_quote', 'get_financials']);
    // Timeline only contains the two executed tools — no fake 'news' event.
    const timelineToolNames = trace.steps.filter((s) => s.kind === 'tool').map((s) => s.tool?.toolName);
    expect(timelineToolNames).toEqual(['get_quote', 'get_financials']);
    expect(trace.tools).toHaveLength(2);
  });

  it('derives completeness: complete with tools + backend ref', () => {
    const trace = projectTrace(
      inputWith({ traceRef: { backend: 'langsmith', traceId: 't-1', threadId: 'pi-1' } })
    );
    expect(trace.completeness).toBe('complete');
  });

  it('derives completeness: partial with tools but no ref/events', () => {
    const trace = projectTrace(inputWith({}));
    expect(trace.completeness).toBe('partial');
  });

  it('derives completeness: minimal with only a traceRef', () => {
    const trace = projectTrace({
      traceRef: { backend: 'langsmith', traceId: 't-1' },
    });
    expect(trace.completeness).toBe('minimal');
    expect(trace.sources).toEqual(['langsmith']);
  });

  it('budget stays absent (never fabricated)', () => {
    const trace = projectTrace(inputWith({}));
    expect(trace.budget).toBeUndefined();
  });

  it('live tool calls take precedence and are sourced as events', () => {
    const live = {
      id: 'live-1',
      toolName: 'get_quote',
      args: { symbol: 'NVDA.US' },
      startedAt: 1500,
      completedAt: 2500,
      status: 'success' as const,
      result: { lastPrice: 121 },
    };
    const trace = projectTrace(inputWith({ liveToolCalls: [live] }));
    expect(trace.tools[0].toolName).toBe('get_quote');
    expect(trace.tools[0].source).toBe('event');
    expect(trace.sources).toContain('event');
  });

  it('live context is labeled live when the caller passes the actual run context', () => {
    const trace = projectTrace(
      inputWith({ liveContext: { workspace: 'NVDA.US · research' } })
    );
    const ws = trace.context.find((c) => c.key === 'workspace');
    expect(ws?.source).toBe('live');
    expect(ws?.value).toBe('NVDA.US · research');
  });

  it('includes trace events as runtime steps when recorded on messages', () => {
    const withTrace: Message = {
      id: 'm-3',
      role: 'assistant',
      content: 'done',
      timestamp: 19000,
      trace: [{ id: 'ev-1', type: 'runtime_info', timestamp: 7000, message: 'started synthesis' }],
    };
    const trace = projectTrace(inputWith({ messages: [assistantWithCalls, withTrace] }));
    expect(trace.sources).toContain('trace-event');
    expect(trace.steps.some((s) => s.kind === 'runtime' && s.detail === 'started synthesis')).toBe(true);
  });
});

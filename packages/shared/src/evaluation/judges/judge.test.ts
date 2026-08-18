import { describe, expect, it } from 'bun:test';
import type {
  EvaluationCase,
  EvaluationDataset,
  EvaluationRun,
  EvaluationSettings,
  ToolCallRecord,
} from '@finagent/core';
import { EvaluatorRegistry, type EvaluationContext } from '../evaluator.ts';
import type { JudgeClient } from '../judge-client.ts';
import { runJudge, type JudgeRubric } from './judge-harness.ts';
import { createGroundednessJudge } from './groundedness.ts';
import { createResearchCompletenessJudge } from './research-completeness.ts';
import { createFinancialReasoningJudge } from './financial-reasoning.ts';
import { createDecisionUsefulnessJudge } from './decision-usefulness.ts';
import { createJudgeEvaluators, registerJudges } from './index.ts';

function toolCall(toolName: string, result: unknown): ToolCallRecord {
  return { id: `tc-${toolName}`, toolName, args: {}, startedAt: 0, status: 'success', result };
}

function makeContext(overrides: {
  answer?: string;
  category?: EvaluationCase['category'];
  dimensions?: string[];
  toolCalls?: ToolCallRecord[];
} = {}): EvaluationContext {
  const { answer = 'The answer.', category = 'market', dimensions = [], toolCalls = [] } = overrides;
  const caseDef: EvaluationCase = {
    id: 'case-1',
    name: 'Test case',
    category,
    difficulty: 'golden',
    input: { prompt: 'Is AAPL a buy?' },
    expected: { requiredResearchDimensions: dimensions },
    tags: [],
    source: 'hand-authored',
  };
  const dataset: EvaluationDataset = {
    id: 'ds-1',
    version: '1.0.0',
    name: 'Test dataset',
    createdAt: 0,
    cases: [],
  };
  const run: EvaluationRun = {
    id: 'run-1',
    experimentId: 'exp-1',
    caseId: 'case-1',
    datasetId: 'ds-1',
    status: 'completed',
    startedAt: 0,
    toolCalls,
    failureModes: [],
    answer,
  };
  const settings: EvaluationSettings = {
    tracingEnabled: false,
    langsmithProject: 'test',
    langsmithEndpoint: '',
    privacyLevel: 'standard',
    onlineEvaluationEnabled: false,
    apiKeyConfigured: false,
    updatedAt: 0,
  };
  return { case: caseDef, dataset, run, settings, toolCalls, now: () => 0 };
}

/** Stub judge model: returns the responder's string for every completion. */
function stubClient(responder: (system: string, user: string) => string): JudgeClient {
  return {
    provider: 'stub',
    model: 'stub-model',
    complete: async (system, user) => responder(system, user),
  };
}

const RUBRIC: JudgeRubric = {
  id: 'groundedness',
  version: 'groundedness-v1',
  systemPrompt: 'Score groundedness.',
  userPrompt: 'Evaluate.',
};

describe('runJudge parse behaviour', () => {
  it('parses a valid STRICT JSON reply', async () => {
    const client = stubClient(() =>
      JSON.stringify({ score: 0.9, reason: 'Supported by corpus.', evidence: ['revenue $10B in corpus'] }),
    );
    const score = await runJudge(client, RUBRIC, makeContext());
    expect(score.metric).toBe('groundedness');
    expect(score.metricVersion).toBe('groundedness-v1');
    expect(score.score).toBe(0.9);
    expect(score.reason).toBe('Supported by corpus.');
    expect(score.detail).toEqual({ evidence: ['revenue $10B in corpus'] });
  });

  it('parses JSON inside a ```json code fence', async () => {
    const client = stubClient(
      () => 'Here is the verdict:\n```json\n{"score": 0.7, "reason": "Mostly grounded."}\n```',
    );
    const score = await runJudge(client, RUBRIC, makeContext());
    expect(score.score).toBe(0.7);
    expect(score.reason).toBe('Mostly grounded.');
  });

  it('parses JSON surrounded by prose', async () => {
    const client = stubClient(
      () => 'The answer is well supported overall. {"score": 0.8, "reason": "Good support."} Hope that helps.',
    );
    const score = await runJudge(client, RUBRIC, makeContext());
    expect(score.score).toBe(0.8);
  });

  it('omits detail when the reply has no evidence', async () => {
    const score = await runJudge(stubClient(() => JSON.stringify({ score: 0.6, reason: 'ok' })), RUBRIC, makeContext());
    expect(score.score).toBe(0.6);
    expect(score.detail).toBeUndefined();
  });

  it('clamps out-of-range scores into 0..1', async () => {
    const high = await runJudge(stubClient(() => JSON.stringify({ score: 1.7, reason: 'x' })), RUBRIC, makeContext());
    expect(high.score).toBe(1);
    const low = await runJudge(stubClient(() => JSON.stringify({ score: -0.3, reason: 'x' })), RUBRIC, makeContext());
    expect(low.score).toBe(0);
  });

  it('degrades unparseable replies to judge_error without throwing', async () => {
    const client = stubClient(() => 'I cannot evaluate this.');
    const score = await runJudge(client, RUBRIC, makeContext());
    expect(score.score).toBeNull();
    expect(score.reason ?? '').toMatch(/^judge_error:/);
  });

  it('degrades structurally invalid JSON to judge_error', async () => {
    const malformed = [
      JSON.stringify({ score: '0.9', reason: 'x' }),
      JSON.stringify({ score: 0.9 }),
      JSON.stringify({ score: 0.9, reason: 'x', evidence: ['ok', 42] }),
      JSON.stringify([{ score: 0.9, reason: 'x' }]),
      '{ not json',
    ];
    for (const reply of malformed) {
      const score = await runJudge(stubClient(() => reply), RUBRIC, makeContext());
      expect(score.score).toBeNull();
      expect(score.reason ?? '').toMatch(/^judge_error:/);
    }
  });

  it('degrades transport failures to judge_error', async () => {
    const failing: JudgeClient = {
      provider: 'stub',
      model: 'stub-model',
      complete: async () => {
        throw new Error('API 500');
      },
    };
    const score = await runJudge(failing, RUBRIC, makeContext());
    expect(score.score).toBeNull();
    expect(score.reason).toContain('judge_error');
    expect(score.reason).toContain('API 500');
  });
});

describe('groundedness judge', () => {
  const corpus = [toolCall('financials', 'FY2024 revenue $10B, net income $2B, PE 25x. No dividend paid.')];

  it('scores a fabricated-metric answer low on groundedness', async () => {
    // Stub simulates a judge model that notices the answer claims a metric the
    // corpus never contains — proving answer + corpus both reach the model.
    const client = stubClient((_system, user) => {
      const [answerSection, corpusSection] = user.split('=== EVIDENCE CORPUS');
      const fabricated = answerSection.includes('EPS of $12.40') && !corpusSection.includes('12.40');
      return JSON.stringify(
        fabricated
          ? { score: 0.2, reason: 'EPS of $12.40 is not in the corpus — fabricated metric.', evidence: ['EPS $12.40 unsupported'] }
          : { score: 0.9, reason: 'All claims traceable to corpus.' },
      );
    });
    const score = await createGroundednessJudge(client).evaluate(
      makeContext({ answer: 'AAPL has EPS of $12.40 and pays a 4% dividend.', toolCalls: corpus }),
    );
    expect(score.metric).toBe('groundedness');
    expect(score.metricVersion).toBe('groundedness-v1');
    expect(score.score).toBeLessThan(0.5);
  });

  it('scores a corpus-supported answer high on groundedness', async () => {
    const client = stubClient(() => JSON.stringify({ score: 0.9, reason: 'All claims traceable.' }));
    const score = await createGroundednessJudge(client).evaluate(
      makeContext({ answer: 'Revenue grew to $10B in FY2024.', toolCalls: corpus }),
    );
    expect(score.score).toBe(0.9);
  });

  it('feeds the answer and evidence corpus into the prompt', async () => {
    let seenUser = '';
    const client = stubClient((_system, user) => {
      seenUser = user;
      return JSON.stringify({ score: 0.9, reason: 'ok' });
    });
    await createGroundednessJudge(client).evaluate(
      makeContext({ answer: 'Revenue was $10B.', toolCalls: [toolCall('quote', 'AAPL revenue $10B')] }),
    );
    expect(seenUser).toContain('Revenue was $10B.');
    expect(seenUser).toContain('AAPL revenue $10B');
  });
});

describe('research completeness judge', () => {
  it('surfaces the required dimensions into the prompt', async () => {
    let seenUser = '';
    const client = stubClient((_system, user) => {
      seenUser = user;
      return JSON.stringify({ score: 0.6, reason: 'Covers three of three.' });
    });
    await createResearchCompletenessJudge(client).evaluate(
      makeContext({ dimensions: ['valuation', 'growth', 'risks'] }),
    );
    expect(seenUser).toContain('valuation');
    expect(seenUser).toContain('growth');
    expect(seenUser).toContain('risks');
  });
});

describe('judge applicability', () => {
  it('groundedness applies only when the run has an answer', () => {
    const judge = createGroundednessJudge(stubClient(() => ''));
    expect(judge.appliesTo?.(makeContext({ answer: '' }))).toBe(false);
    expect(judge.appliesTo?.(makeContext({ answer: 'An answer.' }))).toBe(true);
  });

  it('research completeness needs dimensions or a research category, and an answer', () => {
    const judge = createResearchCompletenessJudge(stubClient(() => ''));
    expect(judge.appliesTo?.(makeContext({ answer: '', dimensions: ['valuation'] }))).toBe(false);
    expect(judge.appliesTo?.(makeContext({ answer: 'x', dimensions: [] }))).toBe(false);
    expect(judge.appliesTo?.(makeContext({ answer: 'x', dimensions: ['valuation'] }))).toBe(true);
    expect(judge.appliesTo?.(makeContext({ answer: 'x', category: 'research' }))).toBe(true);
  });
});

describe('judge registry integration', () => {
  it('createJudgeEvaluators returns the four versioned judges', () => {
    const evaluators = createJudgeEvaluators(stubClient(() => JSON.stringify({ score: 0.5, reason: 'x' })));
    expect(evaluators.map((evaluator) => [evaluator.metric, evaluator.version])).toEqual([
      ['groundedness', 'groundedness-v1'],
      ['research_completeness', 'research-completeness-v1'],
      ['financial_reasoning', 'financial-reasoning-v1'],
      ['decision_usefulness', 'decision-usefulness-v1'],
    ]);
    expect(evaluators.every((evaluator) => evaluator.kind === 'llm-judge')).toBe(true);
  });

  it('registerJudges registers all four metrics', () => {
    const registry = new EvaluatorRegistry();
    registerJudges(registry, stubClient(() => JSON.stringify({ score: 0.5, reason: 'x' })));
    expect([...registry.coveredMetrics()].sort()).toEqual([
      'decision_usefulness',
      'financial_reasoning',
      'groundedness',
      'research_completeness',
    ]);
  });

  it('evaluateAll degrades judge failures to null scores with judge_error reasons, never throwing', async () => {
    const registry = new EvaluatorRegistry();
    const failing: JudgeClient = {
      provider: 'stub',
      model: 'stub-model',
      complete: async () => {
        throw new Error('boom');
      },
    };
    registerJudges(registry, failing);
    const { scores, failures } = await registry.evaluateAll(
      makeContext({ dimensions: ['valuation'] }),
      { includeJudges: true },
    );
    expect(scores).toHaveLength(4);
    expect(failures).toEqual([]);
    for (const score of scores) {
      expect(score.score).toBeNull();
      expect(score.reason ?? '').toMatch(/^judge_error:/);
    }
  });

  it('EvaluatorRegistry records judge_error when an evaluator throws (spec §107)', async () => {
    const registry = new EvaluatorRegistry();
    registry.register({
      metric: 'groundedness',
      name: 'Throwing judge',
      kind: 'llm-judge',
      version: 'groundedness-v1',
      evaluate: async () => {
        throw new Error('kaboom');
      },
    });
    const { scores, failures } = await registry.evaluateAll(makeContext(), { includeJudges: true });
    expect(failures).toEqual(['judge_error']);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ metric: 'groundedness', score: null });
  });
});

describe('smoke: remaining judges pipe through the harness', () => {
  it.each([
    ['financial reasoning', createFinancialReasoningJudge, 'financial_reasoning', 'financial-reasoning-v1'],
    ['decision usefulness', createDecisionUsefulnessJudge, 'decision_usefulness', 'decision-usefulness-v1'],
  ] as const)('%s', async (_label, create, metric, version) => {
    const client = stubClient(() => JSON.stringify({ score: 0.75, reason: 'solid', evidence: ['a'] }));
    const score = await create(client).evaluate(
      makeContext({ answer: 'Sell: the PE is 40x.', toolCalls: [toolCall('quote', 'PE 40x')] }),
    );
    expect(score.metric).toBe(metric);
    expect(score.metricVersion).toBe(version);
    expect(score.score).toBe(0.75);
    expect(score.detail).toEqual({ evidence: ['a'] });
  });
});
// Deterministic evaluator fixture tests (spec §106).
//
// Fixture runs reproduce exact, deterministic scores for every one of the
// twelve metrics — no mocks of the evaluators themselves, only recorded
// ToolCallRecords against hand-authored expectations.
import { describe, expect, it } from 'bun:test';
import type {
  EvaluationCase,
  EvaluationDataset,
  EvaluationExpectations,
  EvaluationFailureMode,
  EvaluationRun,
  EvaluationScore,
  EvaluationSettings,
  ToolCallRecord,
} from '@finagent/core';
import { DEFAULT_EVALUATION_SETTINGS } from '../settings.ts';
import type { EvaluationContext } from '../evaluator.ts';
import { createDeterministicEvaluators, registerDeterministicEvaluators } from './deterministic.ts';
import { EvaluatorRegistry } from '../evaluator.ts';

const NOW = 1_700_000_000_000;
const LATENCY_BUDGET_MS = 60_000;

let callSeq = 0;

function structuredResult(data: unknown, fetchedAt?: number): unknown {
  return fetchedAt === undefined
    ? { data }
    : { data, provenance: { provider: 'longbridge', fetchedAt, stale: false } };
}

function toolCall(
  toolName: string,
  overrides: Partial<ToolCallRecord> = {}
): ToolCallRecord {
  callSeq += 1;
  return {
    id: `c${callSeq}`,
    toolName,
    args: {},
    startedAt: NOW,
    completedAt: NOW + 250,
    status: 'success',
    ...overrides,
  };
}

function makeContext(
  expected: EvaluationExpectations,
  run: Partial<EvaluationRun> & { toolCalls: ToolCallRecord[] },
  caseOverrides: Partial<EvaluationCase> = {}
): EvaluationContext {
  const evaluationCase: EvaluationCase = {
    id: 'case-1',
    name: 'Fixture case',
    category: 'market',
    difficulty: 'golden',
    input: { prompt: 'What is the current price of AAPL?' },
    expected,
    tags: [],
    source: 'hand-authored',
    ...caseOverrides,
  };
  const dataset: EvaluationDataset = {
    id: 'unit-test-dataset',
    version: '1.0.0',
    name: 'Unit Test Dataset',
    createdAt: NOW,
    cases: [evaluationCase],
  };
  const evaluationRun: EvaluationRun = {
    id: 'run-1',
    experimentId: 'exp-1',
    caseId: evaluationCase.id,
    datasetId: dataset.id,
    status: 'completed',
    startedAt: NOW,
    completedAt: NOW + 5_000,
    latencyMs: 5_000,
    answer: '',
    failureModes: [],
    ...run,
  };
  return {
    case: evaluationCase,
    dataset,
    run: evaluationRun,
    settings: DEFAULT_EVALUATION_SETTINGS as EvaluationSettings,
    toolCalls: run.toolCalls,
    now: () => NOW,
  };
}

async function scoreMap(context: EvaluationContext): Promise<Record<string, EvaluationScore>> {
  const entries = await Promise.all(
    createDeterministicEvaluators().map(async (definition) => {
      const score = (await definition.evaluate(context)) as EvaluationScore;
      return [definition.metric, score] as const;
    })
  );
  return Object.fromEntries(entries) as Record<string, EvaluationScore>;
}

function scoreOf(context: EvaluationContext, metric: string): Promise<EvaluationScore> {
  return scoreMap(context).then((map) => map[metric]);
}

describe('createDeterministicEvaluators', () => {
  it('registers exactly the twelve deterministic metrics with matching metadata', () => {
    const registry = new EvaluatorRegistry();
    registerDeterministicEvaluators(registry);
    const defs = registry.list();
    expect(defs).toHaveLength(12);
    const ids = defs.map((d) => d.metric).sort();
    expect(ids).toEqual([
      'argument_validity',
      'evidence_presence',
      'failure_recovery',
      'freshness_compliance',
      'latency',
      'max_tool_calls',
      'partial_failure_honesty',
      'provenance_presence',
      'task_completion',
      'tool_error_rate',
      'tool_precision',
      'tool_recall',
    ]);
    for (const d of defs) {
      expect(d.kind).toBe('deterministic');
      expect(d.version).toBe('1.0.0');
      expect(d.name.length).toBeGreaterThan(0);
    }
  });

  it('create and register agree on the definition list', () => {
    const defs = createDeterministicEvaluators();
    const registry = new EvaluatorRegistry();
    registerDeterministicEvaluators(registry);
    expect(registry.list().map((d) => d.metric)).toEqual(defs.map((d) => d.metric));
  });
});

describe('task_completion (spec §28)', () => {
  it('scores 1.0 for a completed run with an answer and no failing failure modes', async () => {
    const ctx = makeContext({}, {
      toolCalls: [],
      answer: 'AAPL trades at $190.50.',
      status: 'completed',
      failureModes: [],
    });
    const s = await scoreOf(ctx, 'task_completion');
    expect(s.score).toBe(1);
    expect(s.metricVersion).toBe('1.0.0');
  });

  it('scores 0.5 for a completed run that answered despite failure modes', async () => {
    const ctx = makeContext({}, {
      toolCalls: [],
      answer: 'AAPL trades at $190.50.',
      failureModes: ['missing_tool'],
    });
    const s = await scoreOf(ctx, 'task_completion');
    expect(s.score).toBe(0.5);
    expect(s.detail).toMatchObject({ failing: ['missing_tool'] });
  });

  it('ignores judge_error when counting failing failure modes', async () => {
    const ctx = makeContext({}, {
      toolCalls: [],
      answer: 'AAPL trades at $190.50.',
      failureModes: ['judge_error'],
    });
    expect((await scoreOf(ctx, 'task_completion')).score).toBe(1);
  });

  it('scores 0.0 for an empty answer or a non-completed run', async () => {
    const emptyAnswer = makeContext({}, { toolCalls: [], answer: '  ' });
    expect((await scoreOf(emptyAnswer, 'task_completion')).score).toBe(0);
    const failedRun = makeContext({}, {
      toolCalls: [],
      answer: 'AAPL trades at $190.50.',
      status: 'failed',
    });
    expect((await scoreOf(failedRun, 'task_completion')).score).toBe(0);
  });
});

describe('tool_recall (spec §29)', () => {
  it('is 1.0 when no required capabilities are declared', async () => {
    const ctx = makeContext({}, { toolCalls: [toolCall('get_quote')] });
    expect((await scoreOf(ctx, 'tool_recall')).score).toBe(1);
  });

  it('is 1.0 when every required tool is used', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline', 'company.profile'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_company_profile', { args: { symbol: 'AAPL.US' } }),
        ],
      }
    );
    const s = await scoreOf(ctx, 'tool_recall');
    expect(s.score).toBe(1);
    expect(s.detail).toMatchObject({ missing: [] });
  });

  it('scores covered/required and lists missing tool names in detail', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline', 'company.profile'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US' } }),
        ],
      }
    );
    const s = await scoreOf(ctx, 'tool_recall');
    expect(s.score).toBeCloseTo(2 / 3, 10);
    expect(s.detail).toMatchObject({ missing: ['get_company_profile'], required: expect.arrayContaining(['get_quote', 'get_kline', 'get_company_profile']) });
  });
});

describe('tool_precision (spec §30)', () => {
  it('is 1.0 when no tool calls were made', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, { toolCalls: [] });
    expect((await scoreOf(ctx, 'tool_precision')).score).toBe(1);
  });

  it('is 1.0 when every unique call matches required or optional tools', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], optionalCapabilities: ['market.kline'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US' } }),
        ],
      }
    );
    expect((await scoreOf(ctx, 'tool_precision')).score).toBe(1);
  });

  it('penalizes an extra unrelated tool', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_news', { args: { keywords: ['AAPL'] } }),
        ],
      }
    );
    const s = await scoreOf(ctx, 'tool_precision');
    expect(s.score).toBe(0.5);
    expect(s.detail).toMatchObject({ relevant: 1, total: 2, irrelevant: ['get_news'] });
  });

  it('counts failed unique calls in the denominator but not as relevant', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' }, status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US' } }),
        ],
      }
    );
    const s = await scoreOf(ctx, 'tool_precision');
    expect(s.score).toBe(0.5);
  });
});

describe('tool_error_rate (spec §31)', () => {
  it('is 1.0 with no calls and with all-successful calls', async () => {
    const none = makeContext({}, { toolCalls: [] });
    expect((await scoreOf(none, 'tool_error_rate')).score).toBe(1);
    const clean = makeContext({}, { toolCalls: [toolCall('get_quote'), toolCall('get_kline')] });
    expect((await scoreOf(clean, 'tool_error_rate')).score).toBe(1);
  });

  it('scores 1 - failed/total', async () => {
    const ctx = makeContext({}, {
      toolCalls: [
        toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } }),
        toolCall('get_market_status', {}),
      ],
    });
    const s = await scoreOf(ctx, 'tool_error_rate');
    expect(s.score).toBe(0.5);
    expect(s.detail).toMatchObject({ failed: [{ toolName: 'get_quote' }] });
  });
});

describe('argument_validity (spec §32)', () => {
  it('is 1.0 when no required-capability calls were made', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_news', { args: { keywords: ['AAPL'] } })],
    });
    expect((await scoreOf(ctx, 'argument_validity')).score).toBe(1);
  });

  it('scores 1.0 for valid required-capability args, ignoring non-required calls', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US', period: '1d', limit: 100 } }),
          toolCall('get_news', { args: { keywords: 'not-an-object' } }), // not validated
        ],
      }
    );
    expect((await scoreOf(ctx, 'argument_validity')).score).toBe(1);
  });

  it('scores 0.0 when required-capability args violate the input schema, naming the path', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'] },
      {
        toolCalls: [toolCall('get_quote', { args: { symbol: 123 } })],
      }
    );
    const s = await scoreOf(ctx, 'argument_validity');
    expect(s.score).toBe(0);
    expect(s.detail).toMatchObject({ mismatches: [{ toolName: 'get_quote', path: '/symbol' }] });
  });

  it('rejects non-empty args for no-argument tools (portfolio)', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['portfolio.summary'] },
      {
        toolCalls: [
          toolCall('get_portfolio', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_portfolio', { args: {} }),
        ],
      }
    );
    const s = await scoreOf(ctx, 'argument_validity');
    expect(s.score).toBe(0.5);
    expect(s.detail).toMatchObject({ mismatches: [{ toolName: 'get_portfolio', path: '/' }] });
  });

  it('scores 0.5 when half of the required-capability calls are invalid', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' } }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US', period: '2d' } }), // '2d' not in the kline period union
        ],
      }
    );
    expect((await scoreOf(ctx, 'argument_validity')).score).toBe(0.5);
  });
});

describe('max_tool_calls (spec §33)', () => {
  it('is 1.0 within the expected limit and 0.0 above it', async () => {
    const atLimit = makeContext({ maxToolCalls: 2 }, {
      toolCalls: [toolCall('get_quote'), toolCall('get_kline')],
    });
    expect((await scoreOf(atLimit, 'max_tool_calls')).score).toBe(1);
    const over = makeContext({ maxToolCalls: 2 }, {
      toolCalls: [toolCall('get_quote'), toolCall('get_kline'), toolCall('get_news')],
    });
    expect((await scoreOf(over, 'max_tool_calls')).score).toBe(0);
  });

  it('defaults the limit to 8 when the case sets none', async () => {
    const ctx = makeContext({}, {
      toolCalls: [toolCall('get_quote'), toolCall('get_kline'), toolCall('get_news')],
    });
    expect((await scoreOf(ctx, 'max_tool_calls')).score).toBe(1);
  });
});

describe('evidence_presence (spec §33)', () => {
  it('is 1.0 with mustHaveEvidence and a successful call returning data', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], mustHaveEvidence: true },
      { toolCalls: [toolCall('get_quote', { result: structuredResult({ lastPrice: 190.5 }, NOW - 1_000) })] }
    );
    expect((await scoreOf(ctx, 'evidence_presence')).score).toBe(1);
  });

  it('is 0.0 with mustHaveEvidence and only empty results', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], mustHaveEvidence: true },
      {
        toolCalls: [
          toolCall('get_quote', { result: {} }), // plain empty object
          toolCall('get_kline', { result: { data: {} } }), // structured but empty
        ],
      }
    );
    const s = await scoreOf(ctx, 'evidence_presence');
    expect(s.score).toBe(0);
  });

  it('is 1.0 for plain-object results and null when no evidence and not required', async () => {
    const plain = makeContext({}, { toolCalls: [toolCall('get_quote', { result: { lastPrice: 190.5 } })] });
    expect((await scoreOf(plain, 'evidence_presence')).score).toBe(1);
    const none = makeContext({}, { toolCalls: [toolCall('get_quote', { result: undefined })] });
    expect((await scoreOf(none, 'evidence_presence')).score).toBeNull();
  });
});

describe('provenance_presence (spec §33)', () => {
  it('is the fraction of successful calls carrying provider + fetchedAt', async () => {
    const ctx = makeContext({}, {
      toolCalls: [
        toolCall('get_quote', { result: structuredResult({ lastPrice: 190.5 }, NOW - 1_000) }),
        toolCall('get_kline', { result: { data: [] } }), // no provenance
      ],
    });
    const s = await scoreOf(ctx, 'provenance_presence');
    expect(s.score).toBe(0.5);
    expect(s.detail).toMatchObject({ missingProvenance: [{ toolName: 'get_kline' }] });
  });

  it('is null when there are no successful calls', async () => {
    const ctx = makeContext({}, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'X', message: 'x' } })],
    });
    expect((await scoreOf(ctx, 'provenance_presence')).score).toBeNull();
  });
});

describe('freshness_compliance (spec §33)', () => {
  it('is null when the case sets no freshness requirement', async () => {
    const ctx = makeContext({}, { toolCalls: [toolCall('get_quote', { result: structuredResult({ lastPrice: 1 }, NOW - 10_000) })] });
    expect((await scoreOf(ctx, 'freshness_compliance')).score).toBeNull();
  });

  it('is 1.0 when the freshest relevant call is within the requirement', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], freshnessRequirementMs: 60_000 },
      {
        toolCalls: [
          toolCall('get_quote', { result: structuredResult({ lastPrice: 190.5 }, NOW - 10_000) }),
          toolCall('get_kline', { result: structuredResult([{ timestamp: 1 }], NOW - 90_000) }), // optional-ish, older
        ],
      }
    );
    const s = await scoreOf(ctx, 'freshness_compliance');
    expect(s.score).toBe(1);
    expect(s.detail).toMatchObject({ ageMs: 10_000 });
  });

  it('is 0.0 when every relevant call is older than the requirement', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], freshnessRequirementMs: 60_000 },
      {
        toolCalls: [toolCall('get_quote', { result: structuredResult({ lastPrice: 190.5 }, NOW - 120_000) })],
      }
    );
    const s = await scoreOf(ctx, 'freshness_compliance');
    expect(s.score).toBe(0);
    expect(s.detail).toMatchObject({ ageMs: 120_000 });
  });

  it('falls back to completedAt when provenance is absent', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], freshnessRequirementMs: 60_000 },
      {
        toolCalls: [toolCall('get_quote', { result: { lastPrice: 190.5 }, startedAt: NOW - 30_000, completedAt: NOW - 20_000 })],
      }
    );
    expect((await scoreOf(ctx, 'freshness_compliance')).score).toBe(1);
  });
});

describe('partial_failure_honesty (spec §33)', () => {
  it('is null when no call failed', async () => {
    const ctx = makeContext({}, { toolCalls: [toolCall('get_quote')] });
    expect((await scoreOf(ctx, 'partial_failure_honesty')).score).toBeNull();
  });

  it('is 1.0 when the answer names the failed tool', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'provider down' } })],
      answer: 'The get_quote tool failed, so no price is available.',
    });
    expect((await scoreOf(ctx, 'partial_failure_honesty')).score).toBe(1);
  });

  it('is 1.0 when the answer uses fail/error/unavailable wording', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } })],
      answer: 'The quote provider is unavailable right now.',
    });
    expect((await scoreOf(ctx, 'partial_failure_honesty')).score).toBe(1);
  });

  it('is 0.0 when the answer hides the failure', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } })],
      answer: 'AAPL is trading around $190.',
    });
    expect((await scoreOf(ctx, 'partial_failure_honesty')).score).toBe(0);
  });
});

describe('latency (spec §33)', () => {
  it('scores clamp(1 - latencyMs/60s) and reports the raw value in ms', async () => {
    const fast = makeContext({}, { toolCalls: [], latencyMs: 12_000 });
    const fs = await scoreOf(fast, 'latency');
    expect(fs.score).toBeCloseTo(1 - 12_000 / LATENCY_BUDGET_MS, 10);
    expect(fs.value).toBe(12_000);
    expect(fs.unit).toBe('ms');

    const overBudget = makeContext({}, { toolCalls: [], latencyMs: 90_000 });
    expect((await scoreOf(overBudget, 'latency')).score).toBe(0);

    const halfBudget = makeContext({}, { toolCalls: [], latencyMs: 30_000 });
    expect((await scoreOf(halfBudget, 'latency')).score).toBeCloseTo(0.5, 10);
  });

  it('derives latency from completedAt - startedAt when latencyMs is unset', async () => {
    const ctx = makeContext({}, { toolCalls: [], latencyMs: undefined, startedAt: NOW, completedAt: NOW + 15_000 });
    const s = await scoreOf(ctx, 'latency');
    expect(s.score).toBeCloseTo(1 - 15_000 / LATENCY_BUDGET_MS, 10);
    expect(s.value).toBe(15_000);
  });
});

describe('failure_recovery (spec §33)', () => {
  it('is null when no call failed', async () => {
    const ctx = makeContext({}, { toolCalls: [toolCall('get_quote')] });
    expect((await scoreOf(ctx, 'failure_recovery')).score).toBeNull();
  });

  it('is 1.0 when a later successful call uses a different tool', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.status'] },
      {
        toolCalls: [
          toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'provider down' } }),
          toolCall('get_market_status', { startedAt: NOW + 500 }),
        ],
        answer: 'The quote feed failed, so I checked market status instead.',
      }
    );
    const s = await scoreOf(ctx, 'failure_recovery');
    expect(s.score).toBe(1);
  });

  it('is 1.0 when the answer mentions a retry or fallback even without a later call', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } })],
      answer: 'I will retry the request shortly.',
    });
    expect((await scoreOf(ctx, 'failure_recovery')).score).toBe(1);
  });

  it('is 0.0 with no later successful call and no retry/fallback mention', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } })],
      answer: 'AAPL is trading around $190.',
    });
    expect((await scoreOf(ctx, 'failure_recovery')).score).toBe(0);
  });

  it('does not count a later successful call of the same tool as recovery', async () => {
    const ctx = makeContext({ requiredCapabilities: ['market.quote'] }, {
      toolCalls: [
        toolCall('get_quote', { status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'boom' } }),
        toolCall('get_quote', { startedAt: NOW + 500 }),
      ],
    });
    expect((await scoreOf(ctx, 'failure_recovery')).score).toBe(0);
  });
});

describe('fixture runs (spec §106)', () => {
  it('correct tools: every metric on a clean run', async () => {
    const ctx = makeContext(
      {
        requiredCapabilities: ['market.quote', 'market.kline', 'company.profile'],
        mustHaveEvidence: true,
        maxToolCalls: 10,
      },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' }, result: structuredResult({ lastPrice: 190.5 }, NOW - 10_000) }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US', period: '1d' }, result: structuredResult([{ timestamp: NOW / 1000 }], NOW - 20_000) }),
          toolCall('get_company_profile', { args: { symbol: 'AAPL.US' }, result: structuredResult({ name: 'Apple' }, NOW - 30_000) }),
        ],
        answer: 'AAPL last traded at $190.50.',
        latencyMs: 12_000,
        failureModes: [],
      }
    );
    const map = await scoreMap(ctx);
    const expected: Record<string, number | null> = {
      task_completion: 1,
      tool_recall: 1,
      tool_precision: 1,
      tool_error_rate: 1,
      argument_validity: 1,
      max_tool_calls: 1,
      evidence_presence: 1,
      provenance_presence: 1,
      freshness_compliance: null,
      partial_failure_honesty: null,
      failure_recovery: null,
    };
    for (const [metric, score] of Object.entries(expected)) {
      expect(map[metric].score, metric).toBe(score);
    }
    expect(map.latency.score).toBeCloseTo(1 - 12_000 / LATENCY_BUDGET_MS, 10);
  });

  it('missing required tool: recall 2/3 with the missing tool in detail, completion partial', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.kline', 'company.profile'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' }, result: structuredResult({ lastPrice: 190.5 }, NOW - 10_000) }),
          toolCall('get_kline', { args: { symbol: 'AAPL.US' }, result: structuredResult([{ timestamp: 1 }], NOW - 20_000) }),
        ],
        answer: 'AAPL last traded at $190.50.',
        failureModes: ['missing_tool'],
      }
    );
    const map = await scoreMap(ctx);
    expect(map.tool_recall.score).toBeCloseTo(2 / 3, 10);
    expect(map.tool_recall.detail).toMatchObject({ missing: ['get_company_profile'] });
    expect(map.task_completion.score).toBe(0.5);
    expect(map.tool_precision.score).toBe(1);
    expect(map.argument_validity.score).toBe(1);
  });

  it('extra unrelated tool: precision penalized', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' }, result: structuredResult({ lastPrice: 190.5 }, NOW - 10_000) }),
          toolCall('get_news', { args: { keywords: ['AAPL'] }, result: structuredResult([{ title: 'Apple news' }], NOW - 5_000) }),
        ],
        answer: 'AAPL last traded at $190.50.',
        failureModes: ['wrong_tool'],
      }
    );
    const map = await scoreMap(ctx);
    expect(map.tool_precision.score).toBe(0.5);
    expect(map.tool_precision.detail).toMatchObject({ irrelevant: ['get_news'] });
    expect(map.tool_recall.score).toBe(1);
    expect(map.argument_validity.score).toBe(1);
    expect(map.task_completion.score).toBe(0.5);
  });

  it('wrong args: argument_validity 0 with the schema path in detail', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'] },
      {
        toolCalls: [toolCall('get_quote', { args: { symbol: 123 }, result: structuredResult({ lastPrice: 190.5 }, NOW - 1_000) })],
        answer: 'AAPL last traded at $190.50.',
      }
    );
    const map = await scoreMap(ctx);
    expect(map.argument_validity.score).toBe(0);
    expect(map.argument_validity.detail).toMatchObject({ mismatches: [{ toolName: 'get_quote', path: '/symbol' }] });
    expect(map.tool_recall.score).toBe(1);
  });

  it('tool failure: error_rate 0, honesty 1, no recovery', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], mustHaveEvidence: true },
      {
        toolCalls: [toolCall('get_quote', { args: { symbol: 'AAPL.US' }, status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'provider down' } })],
        answer: 'The get_quote tool failed, so no price is available.',
        failureModes: ['provider_failure'],
      }
    );
    const map = await scoreMap(ctx);
    expect(map.tool_error_rate.score).toBe(0);
    expect(map.partial_failure_honesty.score).toBe(1);
    expect(map.failure_recovery.score).toBe(0);
    expect(map.evidence_presence.score).toBe(0);
    expect(map.provenance_presence.score).toBeNull();
    expect(map.task_completion.score).toBe(0.5);
  });

  it('no evidence with mustHaveEvidence: evidence_presence 0', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], mustHaveEvidence: true },
      {
        toolCalls: [toolCall('get_quote', { args: { symbol: 'AAPL.US' }, result: { data: {} } })],
        answer: 'No data found for AAPL.',
      }
    );
    const map = await scoreMap(ctx);
    expect(map.evidence_presence.score).toBe(0);
    // The call itself succeeded, so provenance is present but empty-agnostic: 0/1.
    expect(map.provenance_presence.score).toBe(0);
  });

  it('stale data: freshness 0 when the only relevant call predates the requirement', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote'], freshnessRequirementMs: 60_000 },
      {
        toolCalls: [toolCall('get_quote', { args: { symbol: 'AAPL.US' }, result: structuredResult({ lastPrice: 190.5 }, NOW - 120_000) })],
        answer: 'AAPL last traded at $190.50.',
      }
    );
    const map = await scoreMap(ctx);
    expect(map.freshness_compliance.score).toBe(0);
    expect(map.freshness_compliance.detail).toMatchObject({ ageMs: 120_000 });
  });

  it('provider fallback: recovery 1 via a later successful different tool', async () => {
    const ctx = makeContext(
      { requiredCapabilities: ['market.quote', 'market.status'] },
      {
        toolCalls: [
          toolCall('get_quote', { args: { symbol: 'AAPL.US' }, status: 'error', error: { code: 'CAPABILITY_FAILED', message: 'provider down' } }),
          toolCall('get_market_status', { args: {}, startedAt: NOW + 500, result: structuredResult({ status: 'open' }, NOW + 500) }),
        ],
        answer: 'The quote provider is unavailable, so I checked whether the market is open instead.',
        failureModes: ['provider_failure'],
      }
    );
    const map = await scoreMap(ctx);
    expect(map.failure_recovery.score).toBe(1);
    expect(map.partial_failure_honesty.score).toBe(1);
    expect(map.tool_error_rate.score).toBe(0.5);
    expect(map.tool_recall.score).toBe(1);
    expect(map.argument_validity.score).toBe(1);
  });
});

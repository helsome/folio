// #114 chain integration test: CLI argv → parseFlags → normalizeModelSelection
// → ExperimentService → runtime control → run metadata. The service-level
// fakes in experiment-service.test.ts cover apply/readback/blocking below the
// service boundary; this file stitches the CLI boundary onto that chain so the
// acceptance criterion "not just metadata == CLI input" is exercised end to
// end: the prefixed shorthand must never reach setModel, and the recorded
// effective model must come from the runtime readback, not the request.
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  EvaluationCase,
  EvaluationDataset,
  ExperimentConfig,
  Run,
} from '../../packages/core/src/index.ts';
import { EvaluationStore } from '../../packages/shared/src/evaluation/store.ts';
import { JsonFileStore } from '../../packages/shared/src/storage/json-file-store.ts';
import { LocalEvaluationBackend } from '../../packages/shared/src/evaluation/backend.ts';
import { TraceCorrelationService } from '../../packages/shared/src/evaluation/correlation.ts';
import {
  ExperimentService,
  type ExperimentKernel,
} from '../../packages/shared/src/evaluation/experiment-service.ts';
import { normalizeModelSelection } from '../../packages/shared/src/evaluation/model-selection.ts';
import { parseFlags } from './run.ts';

/** Order-sensitive log of every control call and run start. */
class ChainKernel implements ExperimentKernel {
  readonly events: string[] = [];
  llmState: { sessionId?: string; model?: { id: string; provider: string } | null; thinkingLevel?: string } = {
    sessionId: 'pi-chain-1',
    model: null,
    thinkingLevel: 'off',
  };

  private readonly listeners = new Set<(event: AgentEvent) => void>();

  private readonly api = {
    getState: async () => {
      this.events.push('getState');
      return this.llmState;
    },
    setModel: async (provider: string, modelId: string) => {
      this.events.push(`setModel:${provider}/${modelId}`);
      this.llmState.model = { id: modelId, provider };
      return this.llmState;
    },
    setThinkingLevel: async (level: string) => {
      this.events.push(`setThinkingLevel:${level}`);
      this.llmState.thinkingLevel = level;
      return this.llmState;
    },
  };

  getLlmApi() {
    return this.api;
  }

  sessions = {
    createSession: async () => ({ id: `sess-${this.events.filter((e) => e === 'createSession').length + 1}` }),
  };

  deleteSession = async () => undefined;

  runs = {
    subscribe: (listener: (event: AgentEvent) => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    startRun: async (sessionId: string): Promise<Run> => {
      this.events.push('startRun');
      const run: Run = {
        id: 'run-1',
        sessionId,
        status: 'running',
        input: 'chain',
        startedAt: Date.now(),
      };
      const emit = (type: AgentEvent['type'], payload: unknown) => {
        for (const listener of this.listeners) {
          listener({ id: 'evt-1', sessionId, runId: run.id, type, timestamp: Date.now(), sequence: 0, payload } as AgentEvent);
        }
      };
      emit('run_started', {});
      emit('message_completed', { answer: 'chain answer' });
      emit('run_completed', { answer: 'chain answer', toolCalls: [] });
      run.status = 'completed';
      run.answer = 'chain answer';
      run.completedAt = Date.now();
      return run;
    },
  };
}

function makeCase(id: string): EvaluationCase {
  return {
    id,
    name: id,
    category: 'market',
    difficulty: 'golden',
    input: { prompt: `Prompt for ${id}` },
    expected: {},
    tags: [],
    source: 'hand-authored',
  };
}

const dataset: EvaluationDataset = {
  id: 'chain-dataset',
  version: '1.0.0',
  name: 'Chain',
  createdAt: 0,
  cases: [makeCase('chain-1')],
};

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-chain-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('#114 CLI → service → runtime → metadata chain', () => {
  it('applies the split shorthand before startRun and records the readback model', async () => {
    // CLI boundary: --model provider/model-id + --thinking.
    const options = parseFlags(['--model', 'anthropic/claude-sonnet-4-5', '--thinking', 'high']);
    expect(options.model).toBe('anthropic/claude-sonnet-4-5');
    expect(options.thinking).toBe('high');

    // run.ts builds the config through the same normalization the CLI uses.
    const selection = normalizeModelSelection(options.model, options.provider);
    expect(selection).toEqual({ model: 'claude-sonnet-4-5', provider: 'anthropic' });
    const config: ExperimentConfig = {
      mode: options.mode === 'live' ? 'live' : 'fixture',
      model: selection.model,
      provider: selection.provider,
      thinkingLevel: options.thinking,
    };

    const kernel = new ChainKernel();
    const store = new EvaluationStore(new JsonFileStore(dir));
    const backend = new LocalEvaluationBackend();
    const service = new ExperimentService({
      store,
      kernel,
      backend,
      correlation: new TraceCorrelationService({ backend, store }),
    });

    const experiment = await service.runExperiment({ dataset, config });
    const run = (await store.listRuns(experiment.id))[0];

    // The control call carries the BARE model id — never the prefixed
    // shorthand — and happens before the run starts.
    expect(kernel.events).toContain('setModel:anthropic/claude-sonnet-4-5');
    expect(kernel.events).not.toContain('setModel:anthropic/anthropic/claude-sonnet-4-5');
    expect(kernel.events.indexOf('setModel:anthropic/claude-sonnet-4-5')).toBeLessThan(
      kernel.events.indexOf('startRun')
    );
    expect(kernel.events).toContain('setThinkingLevel:high');

    // Metadata records the runtime readback, not the request echo.
    expect(run.effectiveConfig?.model).toBe('claude-sonnet-4-5');
    expect(run.effectiveConfig?.provider).toBe('anthropic');
    expect(run.effectiveConfig?.thinkingLevel).toBe('high');
    expect(run.effectiveConfig?.unapplied ?? []).toEqual([]);
  });

  it('marks a provider-less model request unapplied instead of inventing an effective model', async () => {
    const options = parseFlags(['--model', 'claude-sonnet-4-5']);
    expect(options.provider).toBeUndefined();
    const selection = normalizeModelSelection(options.model, options.provider);
    expect(selection.model).toBe('claude-sonnet-4-5');

    const kernel = new ChainKernel();
    kernel.llmState.model = { id: 'default-model', provider: 'anthropic' };
    const store = new EvaluationStore(new JsonFileStore(dir));
    const backend = new LocalEvaluationBackend();
    const service = new ExperimentService({
      store,
      kernel,
      backend,
      correlation: new TraceCorrelationService({ backend, store }),
    });

    const experiment = await service.runExperiment({
      dataset,
      config: { mode: 'fixture', model: selection.model, provider: selection.provider },
    });
    const run = (await store.listRuns(experiment.id))[0];

    // No setModel ever fired; the readback default is the honest record and
    // the requested model is explicitly unapplied.
    expect(kernel.events.filter((e) => e.startsWith('setModel:'))).toEqual([]);
    expect(run.effectiveConfig?.model).toBe('default-model');
    expect(run.effectiveConfig?.unapplied).toContainEqual(
      expect.objectContaining({ key: 'model', reason: expect.stringContaining('no provider resolved') })
    );
  });
});

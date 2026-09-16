import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRunInput,
  AgentRuntime,
  ApiResult,
  CapabilityId,
  FinancialDataProvider,
  ProviderHealth,
  ProviderResult,
  RuntimeSession,
  ToolDefinition,
} from '@finagent/core';
import { createCapabilityTools } from '../capabilities/pi-tools.ts';
import { createMarketQuoteCapability } from '../capabilities/manifests/market-quote.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { MessageRepository } from '../storage/message-repository.ts';
import { RunRepository } from '../storage/run-repository.ts';
import { SessionRepository } from '../storage/session-repository.ts';
import { createRouterFetchers } from '../providers/router-fetchers.ts';
import { ProviderRouter } from '../providers/router.ts';
import { RunManager } from './run-manager.ts';
import { SessionManager } from './session-manager.ts';

const FETCHED_AT = 1_710_000_000_123;
const MARKET_TIME = 1_710_000_000_456;
const quote = {
  symbol: 'AAPL.US',
  instrumentId: 'XNAS:AAPL',
  lastPrice: 200,
  change: 3,
  changePercent: 1.5,
  volume: 1234,
  // Quote timestamps are epoch seconds; ProviderProvenance.marketTime below
  // deliberately uses the canonical epoch-millisecond contract.
  timestamp: 1_710_000_000,
  high: 203,
  low: 198,
  open: 199,
  prevClose: 197,
};

let dir = '';
let clock = 10_000;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-quote-provenance-'));
  clock = 10_000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Handler = (
  capabilityId: CapabilityId,
  input: unknown,
  signal?: AbortSignal
) => Promise<ProviderResult<unknown>>;

class FakeFinancialDataProvider implements FinancialDataProvider {
  kind = 'financial-data' as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly handler: Handler
  ) {}

  async status(): Promise<ProviderHealth> {
    return { status: 'connected', lastCheck: clock };
  }

  capabilities(): CapabilityId[] {
    return ['market.quote'];
  }

  markets() {
    return [{ id: 'US', name: 'United States' }];
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    return (await this.handler(capabilityId, input, signal)) as ProviderResult<T>;
  }
}

class ScriptedRuntime implements AgentRuntime {
  constructor(private readonly script: (input: AgentRunInput) => AsyncIterable<AgentEvent>) {}

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: [] };
  }

  async ensureSession(_session: { id: string; title?: string; sessionPath?: string }): Promise<RuntimeSession> {
    return { sessionId: _session.id, status: 'active' };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    yield* this.script(input);
  }

  async cancel(_input: { sessionId: string; runId: string }): Promise<void> {}

  async dispose(): Promise<void> {}
}

function event(
  sessionId: string,
  runId: string,
  type: AgentEvent['type'],
  payload?: AgentEventPayload,
  sequence = 1
): AgentEvent {
  return {
    id: 'evt-' + type + '-' + sequence,
    sessionId,
    runId,
    type,
    timestamp: clock,
    sequence,
    ...(payload === undefined ? {} : { payload }),
  } as unknown as AgentEvent;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for run to settle.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function makeQuoteTool() {
  const router = new ProviderRouter();
  router.register(new FakeFinancialDataProvider('longbridge', 'Longbridge', async () => ({
    ok: false,
    error: { code: 'TIMEOUT', message: 'primary unavailable' },
  })));
  router.register(new FakeFinancialDataProvider('massive', 'Massive', async () => ({
    ok: true,
    data: quote,
    provenance: {
      providerId: 'massive',
      providerName: 'Massive',
      instrumentId: 'XNAS:AAPL',
      fetchedAt: FETCHED_AT,
      marketTime: MARKET_TIME,
      delayed: true,
      stale: false,
    },
  })));
  router.setRouting({ primary: 'longbridge', fallback: 'massive' });

  const capability = createMarketQuoteCapability(createRouterFetchers(router));
  return createCapabilityTools([capability])[0];
}

describe('quote provenance acceptance slice (#101)', () => {
  it('keeps the actual fallback source through the agent tool and evidence reload', async () => {
    const tool = makeQuoteTool();
    const toolResult = await tool.execute('quote-1', { symbol: 'aapl.us' }, new AbortController().signal);

    expect(toolResult.details).toEqual(quote);
    expect(toolResult.provenance).toMatchObject({
      provider: 'massive',
      providerId: 'massive',
      providerName: 'Massive',
      instrumentId: 'XNAS:AAPL',
      fetchedAt: FETCHED_AT,
      marketTime: MARKET_TIME,
      delayed: true,
      stale: false,
      failoverTrail: [
        expect.objectContaining({
          providerId: 'longbridge',
          code: 'TIMEOUT',
          kind: 'timeout',
          attempts: 1,
        }),
      ],
    });
    expect(toolResult.evidence).toMatchObject({
      fallback: { from: 'longbridge', to: 'massive', reason: 'TIMEOUT' },
    });

    const structuredResult = {
      data: toolResult.details,
      provenance: toolResult.provenance,
      evidence: toolResult.evidence,
    };
    const runtime = new ScriptedRuntime(async function* (input) {
      yield event(input.sessionId, input.runId, 'tool_started', {
        toolCall: {
          id: 'quote-1',
          toolName: 'get_quote',
          args: { symbol: 'AAPL.US' },
          startedAt: clock,
          status: 'running',
        },
      });
      yield event(input.sessionId, input.runId, 'tool_completed', {
        toolCall: {
          id: 'quote-1',
          toolName: 'get_quote',
          args: { symbol: 'AAPL.US' },
          startedAt: clock,
          completedAt: clock,
          status: 'success',
          result: structuredResult,
        },
      });
      yield event(input.sessionId, input.runId, 'message_completed', {
        answer: 'Apple is $200.00; source: Massive.',
      });
      yield event(input.sessionId, input.runId, 'run_completed', {
        answer: 'Apple is $200.00; source: Massive.',
        toolCalls: [],
      });
    });
    const store = new JsonFileStore(dir);
    const sessions = new SessionManager({
      sessions: new SessionRepository(store),
      messages: new MessageRepository(store),
      runs: new RunRepository(store),
      piSessionDir: join(dir, 'pi-sessions'),
      now: () => clock,
    });
    const runs = new RunManager({
      sessions,
      runs: new RunRepository(store),
      runtime,
      now: () => clock,
    });
    const session = await sessions.createSession('Quote provenance');

    await runs.startRun(session.id, "What is Apple's current price and where did it come from?");
    await waitFor(() => !runs.isRunning());

    const messages = await sessions.listMessages(session.id);
    const evidence = messages[1].financialEvidence?.[0];
    expect(evidence).toMatchObject({
      provider: 'massive',
      instrumentId: 'XNAS:AAPL',
      retrievedAt: FETCHED_AT,
      asOf: MARKET_TIME,
      delayed: true,
      stale: false,
      fallback: { from: 'longbridge', to: 'massive', reason: 'TIMEOUT' },
    });
    expect(evidence?.lineage.some((step) => step.kind === 'fallback')).toBe(true);

    // A fresh repository instance proves that citation-facing provenance is
    // persisted as part of the assistant message, not recomputed on reload.
    const reloaded = await new MessageRepository(store).list(session.id);
    expect(reloaded[1].financialEvidence).toEqual(messages[1].financialEvidence);
  });
});

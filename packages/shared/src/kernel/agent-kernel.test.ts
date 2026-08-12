import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { AgentEvent, Kline, Portfolio, Quote } from '@finagent/core';
import { AgentKernel } from './agent-kernel.ts';
import { MarketDataService } from '../agent/market-data-service.ts';

const quote: Quote = {
  symbol: 'AAPL.US',
  lastPrice: 200,
  change: 3,
  changePercent: 1.5,
  volume: 1234,
  timestamp: 1710000000,
  high: 203,
  low: 198,
  open: 199,
  prevClose: 197,
};

const kline: Kline = {
  symbol: 'AAPL.US',
  timestamp: 1710000000,
  open: 198,
  high: 203,
  low: 197,
  close: 200,
  volume: 4567,
};

const portfolio: Portfolio = {
  totalValue: 10000,
  cash: 1500,
  positions: [
    {
      symbol: 'AAPL.US',
      name: 'Apple',
      quantity: 10,
      avgCost: 180,
      lastPrice: 200,
      marketValue: 2000,
      unrealizedPnL: 200,
      unrealizedPnLPercent: 11.11,
    },
  ],
};

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-e2e-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createKernel() {
  const marketData = new MarketDataService({
    fetchers: {
      getQuote: async () => quote,
      getKline: async () => [kline],
      getPortfolio: async () => portfolio,
      getIntraday: async () => [],
      getLongBridgeStatus: async () => ({
        installed: true,
        authed: true,
        available: true,
        status: 'available',
      }),
    },
  });

  return new AgentKernel({
    storageDir: join(dir, 'store'),
    piSessionDir: join(dir, 'pi-sessions'),
    provider: 'local',
    marketData,
  });
}

async function collectRun(kernel: AgentKernel, sessionId: string, content: string) {
  const types: string[] = [];
  const unsubscribe = kernel.runs.subscribe((event: AgentEvent) => types.push(event.type));
  const run = await kernel.runs.startRun(sessionId, content);
  await waitFor(async () => !kernel.runs.isRunning());
  unsubscribe();
  return { run, types };
}

describe('AgentKernel E2E agent loop', () => {
  it('runs the portfolio-risk scenario end to end with the local runtime', async () => {
    const kernel = createKernel();
    const session = await kernel.sessions.createSession('Risk Review');

    const { run, types } = await collectRun(kernel, session.id, '分析一下我当前持仓最大的风险');

    expect(run.status).toBe('completed');
    expect(types).toEqual([
      'run_started',
      'tool_started',
      'tool_completed',
      'tool_started',
      'tool_completed',
      'tool_started',
      'tool_completed',
      'message_started',
      'message_delta',
      'message_completed',
      'run_completed',
    ]);

    const messages = await kernel.sessions.listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('分析一下我当前持仓最大的风险');
    expect(messages[1].content).toContain('Portfolio Risk Summary');
    expect(messages[1].toolCalls?.map((toolCall) => toolCall.toolName)).toEqual([
      'get_portfolio',
      'get_quote',
      'get_kline',
    ]);

    await kernel.dispose();
  });

  it('recovers sessions, messages, and runs after an app restart', async () => {
    const first = createKernel();
    const session = await first.sessions.createSession('Restart Test');
    const run = (await collectRun(first, session.id, 'AAPL.US quote')).run;
    await first.dispose();

    // Simulate restart: a brand-new kernel on the same storage directory.
    const second = createKernel();
    const sessions = await second.sessions.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: session.id, title: 'Restart Test' });

    const messages = await second.sessions.listMessages(session.id);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('AAPL.US quote');
    expect(messages[1].content).toContain('AAPL.US');

    const runs = await second.sessions.listRuns(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: run.id, status: 'completed' });

    await second.dispose();
  });

  it('keeps conversation context when continuing a session after restart', async () => {
    const first = createKernel();
    const session = await first.sessions.createSession('Follow-up');
    await collectRun(first, session.id, 'AAPL.US quote');
    await first.dispose();

    const second = createKernel();
    // The local runtime remembers recent symbols per session; a follow-up
    // without an explicit symbol must resolve through session context.
    const followUpRun = (await collectRun(second, session.id, '看下走势')).run;

    expect(followUpRun.status).toBe('completed');
    const messages = await second.sessions.listMessages(session.id);
    expect(messages).toHaveLength(4);
    expect(messages[3].content).toContain('AAPL.US K-Line');

    await second.dispose();
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

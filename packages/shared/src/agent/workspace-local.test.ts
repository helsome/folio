// WorkspaceContext → Agent run (local runtime): the workspace's active symbol
// must inform intent routing without being named in the user message.

import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { FinanceCapability } from '@finagent/core';
import { LocalRuntimeAdapter } from './local-runtime-adapter.ts';
import { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';
import { FinanceToolRegistry } from './finance-tool-registry.ts';

function fakeMarketData() {
  return {
    getQuote: async () => ({
      symbol: 'NVDA.US',
      lastPrice: 192.6,
      change: 2.03,
      changePercent: 1.07,
      volume: 1000,
      timestamp: 1,
      high: 193,
      low: 190,
      open: 191,
      prevClose: 190.57,
    }),
    getKline: async () => [
      { symbol: 'NVDA.US', timestamp: 1, open: 190, high: 192, low: 189, close: 191, volume: 1000 },
      { symbol: 'NVDA.US', timestamp: 2, open: 191, high: 194, low: 190, close: 193, volume: 1200 },
    ],
    getIntraday: async () => [],
    getPortfolio: async () => ({ baseCurrency: 'USD', accounts: [], holdings: [], fetchedAt: 0 }),
    getLongBridgeStatus: async () => ({ installed: true, available: true } as never),
  } as never;
}

describe('WorkspaceContext → agent run (local)', () => {
  it('routes "最近走势怎么样？" to kline using the active workspace symbol', async () => {
    const backend = new LocalFinanceAgentBackend({ marketData: fakeMarketData() });
    const adapter = new LocalRuntimeAdapter({ backend });

    const toolNames: string[] = [];
    const answers: string[] = [];
    for await (const event of adapter.run({
      sessionId: 's1',
      runId: 'r1',
      content: '最近走势怎么样？',
      workspaceContext: { activeSymbol: 'NVDA.US', activeView: 'chart' },
    })) {
      if (event.type === 'tool_started') toolNames.push(event.payload.toolCall.toolName);
      if (event.type === 'message_delta') answers.push(event.payload.answer);
    }

    expect(toolNames).toEqual(['get_kline']);
    expect(answers.join('')).toContain('NVDA');
  });

  it('without workspace context the same message is unsupported', async () => {
    const backend = new LocalFinanceAgentBackend({ marketData: fakeMarketData() });
    const adapter = new LocalRuntimeAdapter({ backend });

    const answers: string[] = [];
    for await (const event of adapter.run({
      sessionId: 's2',
      runId: 'r2',
      content: '最近走势怎么样？',
    })) {
      if (event.type === 'message_delta') answers.push(event.payload.answer);
    }

    expect(answers.join('')).toContain('标的代码');
  });

  it('propagates cancellation to an in-flight capability execution', async () => {
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hangingQuote = {
      id: 'market.quote',
      name: 'Quote',
      description: 'A hanging quote capability for cancellation tests.',
      category: 'market',
      riskLevel: 'read',
      auth: 'public',
      toolName: 'get_quote',
      inputSchema: Type.Object({ symbol: Type.String() }),
      async execute() {
        markStarted();
        await new Promise<never>(() => undefined);
        return { data: { symbol: 'AAPL.US' } };
      },
    } as unknown as FinanceCapability;
    const registry = new FinanceToolRegistry({
      list: () => [hangingQuote],
      get: () => hangingQuote,
      query: () => [hangingQuote],
    });
    const adapter = new LocalRuntimeAdapter({
      backend: new LocalFinanceAgentBackend({ registry }),
    });
    const iterator = adapter.run({
      sessionId: 's-cancel',
      runId: 'r-cancel',
      content: 'AAPL.US quote',
    })[Symbol.asyncIterator]();

    const nextEvent = iterator.next();
    await started;
    await adapter.cancel({ sessionId: 's-cancel', runId: 'r-cancel' });
    const event = await nextEvent;

    expect(event.done).toBe(false);
    expect(event.value?.type).toBe('run_failed');
    if (event.value?.type === 'run_failed') {
      expect(event.value.payload.error.code).toBe('RUN_CANCELLED');
    }
  });
});

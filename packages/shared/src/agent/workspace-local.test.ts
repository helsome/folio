// WorkspaceContext → Agent run (local runtime): the workspace's active symbol
// must inform intent routing without being named in the user message.

import { describe, expect, it } from 'bun:test';
import { LocalRuntimeAdapter } from './local-runtime-adapter.ts';
import { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';

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
});

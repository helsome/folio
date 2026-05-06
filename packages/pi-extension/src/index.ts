// Pi Agent tool interface (local definition since @pi-agent/sdk is not on npm)
// Using looser types for flexibility
interface Tool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (
    toolCallId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any,
    signal: AbortSignal
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

interface ProviderConfig {
  baseUrl?: string;
}

interface AgentApi {
  registerTool: (tool: Tool) => void;
  registerProvider?: (name: string, config: ProviderConfig) => void;
}

import { getQuoteTool } from './tools/getQuote.ts';
import { getPortfolioTool } from './tools/getPortfolio.ts';
import { getKlineTool, getIntradayTool } from './tools/getKline.ts';

// Tool registry
export const tools: Tool[] = [
  getQuoteTool,
  getPortfolioTool,
  getKlineTool,
  getIntradayTool,
];

// Export individual tools
export { getQuoteTool } from './tools/getQuote.ts';
export { getPortfolioTool } from './tools/getPortfolio.ts';
export { getKlineTool, getIntradayTool } from './tools/getKline.ts';

// Register all tools with Pi Agent
export function registerTools(agent: AgentApi) {
  for (const tool of tools) {
    agent.registerTool(tool);
  }
}

export function registerProviderOverrides(agent: AgentApi) {
  if (typeof agent.registerProvider !== 'function') return;

  agent.registerProvider('anthropic', {
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.minimaxi.com/anthropic',
  });
}

// Type exports
export type { Quote, Portfolio, Kline, IntradayData } from '@finagent/core';
export type { Tool };

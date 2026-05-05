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
export function registerTools(agent: { registerTool: (tool: Tool) => void }) {
  for (const tool of tools) {
    agent.registerTool(tool);
  }
}

// Type exports
export type { Quote, Portfolio, Kline, IntradayData } from '@finagent/core';
export type { Tool };

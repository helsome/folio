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

interface ProviderModelConfig {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ProviderModelConfig[];
}

interface AgentApi {
  registerTool: (tool: Tool) => void;
  registerProvider?: (name: string, config: ProviderConfig) => void;
}

import { createCapabilityTools as buildCapabilityTools, fullCapabilities } from '@finagent/shared/capabilities';
import { listSkillResourcesTool, readSkillResourceTool } from './tools/skillResources.ts';

/** Finance tools generated from the shared capability registry manifests. */
export function createCapabilityTools(): Tool[] {
  return buildCapabilityTools(fullCapabilities);
}

// Tool registry
export const tools: Tool[] = [
  ...createCapabilityTools(),
  listSkillResourcesTool,
  readSkillResourceTool,
];

// Export the two hand-written skill-resource tools.
export { listSkillResourcesTool, readSkillResourceTool };

// Register all tools with Pi Agent
export function registerTools(agent: AgentApi) {
  for (const tool of tools) {
    agent.registerTool(tool);
  }
}

interface ProviderOverride {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ProviderModelConfig[];
}

/** Parse Folio-owned provider overrides from FINAGENT_PROVIDER_OVERRIDES. */
function readProviderOverrides(): ProviderOverride[] {
  const raw = process.env.FINAGENT_PROVIDER_OVERRIDES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ProviderOverride =>
        Boolean(entry) && typeof entry === 'object' && typeof entry.provider === 'string'
    );
  } catch {
    return [];
  }
}

export function registerProviderOverrides(agent: AgentApi) {
  if (typeof agent.registerProvider !== 'function') return;

  // Legacy static override: keep the historical Anthropic base URL behavior
  // unless Folio supplies explicit overrides for anthropic.
  const overrides = readProviderOverrides();
  const hasAnthropicOverride = overrides.some((entry) => entry.provider === 'anthropic');
  if (!hasAnthropicOverride) {
    agent.registerProvider('anthropic', {
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.minimaxi.com/anthropic',
    });
  }

  for (const entry of overrides) {
    const config: ProviderConfig = {};
    if (entry.baseUrl !== undefined) config.baseUrl = entry.baseUrl;
    if (entry.apiKey !== undefined) config.apiKey = entry.apiKey;
    if (entry.api !== undefined) config.api = entry.api;
    if (entry.models !== undefined) config.models = entry.models;
    agent.registerProvider(entry.provider, config);
  }
}

// Type exports
export type { Quote, Portfolio, Kline, IntradayData } from '@finagent/core';
export type { Tool };

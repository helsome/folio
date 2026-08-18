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
import type { PrivacyLevel } from '@finagent/core';
import { listSkillResourcesTool, readSkillResourceTool } from './tools/skillResources.ts';

/** Privacy level for Pi tool output, fixed once at module load (spec §60). */
const PI_PRIVACY_LEVEL = readPrivacyLevelEnv(process.env);

/**
 * Read the Finagent tool-output privacy level from an env object
 * (FINAGENT_PRIVACY_LEVEL=minimal|standard|full). Unknown, empty, or unset
 * values mean no privacy wrapping — tools keep their raw DATA blocks.
 */
export function readPrivacyLevelEnv(
  env: Record<string, string | undefined>
): 'minimal' | 'standard' | 'full' | undefined {
  const raw = env.FINAGENT_PRIVACY_LEVEL;
  if (!raw) return undefined;
  const level = raw.trim().toLowerCase();
  if (level === 'minimal' || level === 'standard' || level === 'full') return level;
  return undefined;
}

/**
 * Wrap tools so portfolio DATA blocks never reach the model below `full`
 * (spec §60). The original execute runs untouched (same params + signal, so
 * aborts propagate); only its returned text is rewritten — summary kept, the
 * raw DATA section replaced by a privacy notice.
 */
export function wrapToolsWithPrivacy(
  tools: readonly Tool[],
  level: 'minimal' | 'standard' | 'full' | undefined
): Tool[] {
  if (level === undefined || level === 'full') return [...tools];
  // Portfolio tools carry account data (holdings, positions, cash, account
  // ids); identify them by capability-id convention /^portfolio\./ or by
  // tool names that embed the word (get_portfolio, …).
  return tools.map((tool) =>
    /^portfolio\./.test(tool.name) || tool.name.includes('portfolio')
      ? { ...tool, execute: wrapPortfolioExecute(tool.execute, level) }
      : tool
  );
}

const DATA_MARKER = '\n\nDATA: ';

function wrapPortfolioExecute(
  execute: Tool['execute'],
  level: 'minimal' | 'standard'
): Tool['execute'] {
  return async (toolCallId, params, signal) => {
    const result = await execute(toolCallId, params, signal);
    return {
      content: result.content.map((block) => {
        if (block.type !== 'text') return block;
        const marker = block.text.indexOf(DATA_MARKER);
        // Keep only the summary; drop everything after the DATA marker (or the
        // whole payload if the marker is missing) — never leak raw values.
        const summary = marker >= 0 ? block.text.slice(0, marker) : '';
        return {
          ...block,
          text: `${summary}\n\n[Finagent privacy level ${level}: portfolio details redacted]`,
        };
      }),
    };
  };
}

/** Finance tools generated from the shared capability registry manifests. */
export function createCapabilityTools(): Tool[] {
  return wrapToolsWithPrivacy(buildCapabilityTools(fullCapabilities), PI_PRIVACY_LEVEL);
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

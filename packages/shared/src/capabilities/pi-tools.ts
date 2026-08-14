import type { FinanceCapability } from '@finagent/core';
import { validateInput } from './validate.ts';

/** Shape the Pi Agent runtime expects for a registered tool. */
export interface CapabilityTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

/**
 * Generate Pi tool objects from capabilities. Each tool's text is the manifest
 * `summary` plus a `DATA: <json>` block, so the agent reads facts while product
 * workflows use the structured `data` from the registry directly.
 */
export function createCapabilityTools(capabilities: FinanceCapability[]): CapabilityTool[] {
  return capabilities.map((cap) => ({
    name: cap.toolName,
    label: cap.name,
    description: cap.description,
    parameters: cap.inputSchema,
    async execute(_toolCallId, rawParams, signal) {
      const input = validateInput(cap.inputSchema, rawParams);
      const result = await cap.execute(input, { signal });
      const json = JSON.stringify(result.data);
      const text = result.summary ? `${result.summary}\n\nDATA: ${json}` : `DATA: ${json}`;
      return { content: [{ type: 'text', text }] };
    },
  }));
}

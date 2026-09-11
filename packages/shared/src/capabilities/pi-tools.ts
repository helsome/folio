import type { FinanceCapability, NewsItem } from '@finagent/core';
import { validateInput } from './validate.ts';
import { sanitizeNewsItem, sanitizeUntrustedText } from '../research/sanitize.ts';

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
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details?: unknown;
    provenance?: unknown;
    evidence?: unknown;
  }>;
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
    async execute(toolCallId, rawParams, signal) {
      const input = validateInput(cap.inputSchema, rawParams);
      const result = await cap.execute(input, { signal });
      // Security (defense in depth): external-text payloads such as news are
      // sanitized again at the LLM boundary. The capability manifest already
      // sanitizes at ingestion; this wrapper covers any provider that does not.
      const data = isNewsItemList(result.data) ? result.data.map(sanitizeNewsItem) : result.data;
      const summary = result.summary ? sanitizeUntrustedText(result.summary).text : undefined;
      const json = JSON.stringify(data);
      const base = summary ? `${summary}\n\nDATA: ${json}` : `DATA: ${json}`;
      // #30: surface the tool-call id so the model can cite this exact origin.
      const text = `${base}\n\nEVIDENCE: ${toolCallId}`;
      return {
        content: [{ type: 'text', text }],
        details: data,
        provenance: result.provenance,
        evidence: result.evidence,
      };
    },
  }));
}

/** Structural check for news-shaped payloads (title/summary/url items). */
function isNewsItemList(data: unknown): data is NewsItem[] {
  return Array.isArray(data)
    && data.length > 0
    && data.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return typeof record.title === 'string' && typeof record.summary === 'string' && typeof record.url === 'string';
    });
}

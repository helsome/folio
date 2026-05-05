import type { AgentResponse, ToolCallRecord } from '@finagent/core';
import type { FinanceToolName, FinanceToolResult } from './finance-tool-registry.ts';

export function composeToolResponse(
  toolName: FinanceToolName,
  result: FinanceToolResult,
  toolCall: ToolCallRecord
): AgentResponse {
  return {
    content: result.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n'),
    tool: toolName,
    toolName,
    result,
    details: result.details,
    toolCalls: [toolCall],
  };
}

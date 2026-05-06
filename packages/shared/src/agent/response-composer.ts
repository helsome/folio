import type { AgentResponse, AgentSessionSnapshot, ToolCallRecord } from '@finagent/core';
import type { FinanceToolName, FinanceToolResult } from './finance-tool-registry.ts';

export function composeToolResponse(
  toolName: FinanceToolName,
  result: FinanceToolResult,
  toolCall: ToolCallRecord,
  session: AgentSessionSnapshot
): AgentResponse {
  const content = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  return {
    answer: content,
    content,
    tool: toolName,
    toolName,
    result,
    details: result.details,
    toolCalls: [toolCall],
    session,
    sessionSnapshot: session,
  };
}

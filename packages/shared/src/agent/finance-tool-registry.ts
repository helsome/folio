import type {
  CapabilityRegistry,
  FinanceCapability,
  ToolDefinition,
  ToolResultProvenance,
} from '@finagent/core';
import { CapabilityExecutor } from '../capabilities/executor.ts';
import { createPhaseOneRegistry } from '../capabilities/index.ts';
import { createCodeError } from './errors.ts';

export type FinanceToolName =
  | 'get_quote'
  | 'get_kline'
  | 'get_intraday'
  | 'get_market_status'
  | 'get_company_profile'
  | 'get_valuation'
  | 'get_news'
  | 'get_portfolio'
  | 'get_market_depth'
  | 'get_trades'
  | 'get_capital_flow'
  | 'get_market_sentiment'
  | 'get_financials'
  | 'get_ratings'
  | 'get_dividends'
  | 'get_earnings'
  | 'get_calendar_events'
  | 'get_positions'
  | 'get_assets'
  | 'get_cash_flow';

export interface FinanceToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
  provenance?: ToolResultProvenance;
}

export interface ExecuteToolInput {
  name: FinanceToolName;
  args: Record<string, unknown>;
}

export interface FinanceToolRegistryOptions {
  now?: () => number;
}

/**
 * Agent-facing facade over the capability registry: exposes the phase-1
 * capabilities as `ToolDefinition`s and executes them through the
 * `CapabilityExecutor`, mapping failures back to code errors.
 */
export class FinanceToolRegistry {
  private readonly executor: CapabilityExecutor;
  private readonly byToolName: Map<string, FinanceCapability>;

  constructor(
    registry: CapabilityRegistry = createPhaseOneRegistry(),
    options: FinanceToolRegistryOptions = {}
  ) {
    this.executor = new CapabilityExecutor({ now: options.now });
    this.byToolName = new Map(registry.list().map((cap) => [cap.toolName, cap]));
  }

  getTools(): ToolDefinition[] {
    return [...this.byToolName.values()].map((cap) => ({
      name: cap.toolName,
      label: cap.name,
      description: cap.description,
      parameters: cap.inputSchema as Record<string, unknown>,
    }));
  }

  async execute(input: ExecuteToolInput): Promise<FinanceToolResult> {
    const cap = this.byToolName.get(input.name);
    if (!cap) {
      throw createCodeError('TOOL_NOT_FOUND', `Tool is not registered: ${input.name}`);
    }

    const { record, result } = await this.executor.run(cap, input.args);
    if (!result) {
      throw createCodeError(
        failureCode(record.status),
        record.error ?? `Capability ${cap.id} ${record.status}.`
      );
    }

    return {
      content: [{ type: 'text', text: result.summary ?? JSON.stringify(result.data) }],
      details: result.data,
      provenance: result.provenance,
    };
  }
}

function failureCode(status: string) {
  if (status === 'cancelled') return 'RUN_CANCELLED';
  if (status === 'unavailable') return 'CAPABILITY_UNAVAILABLE';
  return 'CAPABILITY_FAILED';
}

import type { AgentBackend, AgentBackendProvider } from '@finagent/core';
import { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';

export interface AgentBackendFactoryOptions {
  provider?: AgentBackendProvider;
}

export function createAgentBackend(options: AgentBackendFactoryOptions = {}): AgentBackend {
  const provider = options.provider ?? 'local';

  if (provider === 'local') {
    return new LocalFinanceAgentBackend();
  }

  throw new Error('Pi runtime backend is not wired yet. Use provider: local.');
}

export { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';
export { FinanceToolRegistry } from './finance-tool-registry.ts';
export { MarketDataService } from './market-data-service.ts';
export { routeFinanceIntent } from './intent-router.ts';

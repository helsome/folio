import type { AgentBackend, AgentBackendProvider } from '@finagent/core';
import { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';
import { PiRuntimeAgentBackend, type PiRuntimeAgentBackendOptions } from './pi-runtime-agent-backend.ts';

export interface AgentBackendFactoryOptions {
  provider?: AgentBackendProvider;
  piRuntime?: PiRuntimeAgentBackendOptions;
}

export function createAgentBackend(options: AgentBackendFactoryOptions = {}): AgentBackend {
  const provider = options.provider ?? readProviderFromEnv() ?? 'local';

  if (provider === 'local') {
    return new LocalFinanceAgentBackend();
  }

  return new PiRuntimeAgentBackend({
    ...options.piRuntime,
    rpc: {
      requiredEnvKeys: readRequiredLlmEnvKeys(),
      ...options.piRuntime?.rpc,
    },
  });
}

export { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';
export { PiRuntimeAgentBackend } from './pi-runtime-agent-backend.ts';
export { PiRpcClient } from './pi-rpc-client.ts';
export { FinanceToolRegistry } from './finance-tool-registry.ts';
export { MarketDataService } from './market-data-service.ts';
export { routeFinanceIntent } from './intent-router.ts';

function readProviderFromEnv(): AgentBackendProvider | undefined {
  const value = process.env.FINAGENT_AGENT_PROVIDER;
  if (value === 'local' || value === 'pi-runtime') return value;
  return undefined;
}

function readRequiredLlmEnvKeys() {
  if (process.env.FINAGENT_REQUIRE_LLM_ENV === '0') return [];
  const value = process.env.FINAGENT_REQUIRED_LLM_ENV;
  if (value) {
    return value.split(',').map((key) => key.trim()).filter(Boolean);
  }
  return ['ANTHROPIC_API_KEY'];
}

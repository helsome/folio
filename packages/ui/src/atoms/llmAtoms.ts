import { atom } from 'jotai';
import type {
  CredentialInfo,
  LlmModel,
  LlmRuntimeState,
  ProviderStatus,
} from '@finagent/core';
import type { FinagentClient } from '../client';

// ---------------------------------------------------------------------------
// LLM control-plane state: hydrated from the Pi runtime through the kernel.
// The kernel is the source of truth; these atoms are view caches.
// ---------------------------------------------------------------------------

export interface LlmState {
  loading: boolean;
  error: string | null;
  runtimeProvider: string;
  model?: LlmModel;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  isStreaming: boolean;
}

export const llmStateAtom = atom<LlmState>({
  loading: false,
  error: null,
  runtimeProvider: 'unknown',
  thinkingLevel: 'off',
  availableThinkingLevels: [],
  isStreaming: false,
});

export const llmModelsAtom = atom<LlmModel[]>([]);

export const llmProvidersAtom = atom<ProviderStatus[]>([]);

export const llmCredentialsAtom = atom<CredentialInfo[]>([]);

/** Hydrate the full LLM state snapshot from the kernel. */
export const hydrateLlmAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    set(llmStateAtom, (state) => ({ ...state, loading: true, error: null }));
    try {
      const result = await client.llm.getState();
      if (!result.ok) {
        set(llmStateAtom, (state) => ({
          ...state,
          loading: false,
          error: result.error.message,
        }));
        return;
      }
      const runtimeState: LlmRuntimeState = result.data;
      set(llmStateAtom, {
        loading: false,
        error: null,
        runtimeProvider: runtimeState.runtimeProvider,
        model: runtimeState.model,
        thinkingLevel: runtimeState.thinkingLevel,
        availableThinkingLevels: runtimeState.availableThinkingLevels,
        isStreaming: runtimeState.isStreaming,
      });
    } catch (error) {
      set(llmStateAtom, (state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load LLM state.',
      }));
    }
  }
);

export const refreshLlmModelsAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    const result = await client.llm.listModels();
    if (result.ok) {
      set(llmModelsAtom, result.data);
    }
    return result;
  }
);

export const refreshLlmProvidersAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    const [providers, credentials] = await Promise.all([
      client.llm.getProviders(),
      client.llm.listCredentials(),
    ]);
    if (providers.ok) set(llmProvidersAtom, providers.data);
    if (credentials.ok) set(llmCredentialsAtom, credentials.data);
    return providers;
  }
);

export const setLlmModelAtom = atom(
  null,
  async (_get, set, input: { client: FinagentClient; provider: string; modelId: string }) => {
    const { client, provider, modelId } = input;
    set(llmStateAtom, (state) => ({ ...state, error: null }));
    const result = await client.llm.setModel(provider, modelId);
    if (result.ok) {
      set(llmStateAtom, (state) => ({
        ...state,
        model: result.data.model,
        thinkingLevel: result.data.thinkingLevel,
        availableThinkingLevels: result.data.availableThinkingLevels,
      }));
    }
    return result;
  }
);

export const setLlmThinkingAtom = atom(
  null,
  async (_get, set, input: { client: FinagentClient; level: string }) => {
    const { client, level } = input;
    const result = await client.llm.setThinkingLevel(level);
    if (result.ok) {
      set(llmStateAtom, (state) => ({
        ...state,
        thinkingLevel: result.data.thinkingLevel,
      }));
    }
    return result;
  }
);

/** Group models by provider, preserving registry order. */
export function groupModelsByProvider(models: LlmModel[]): Array<{
  provider: string;
  models: LlmModel[];
}> {
  const groups = new Map<string, LlmModel[]>();
  for (const model of models) {
    const list = groups.get(model.provider);
    if (list) {
      list.push(model);
    } else {
      groups.set(model.provider, [model]);
    }
  }
  return Array.from(groups.entries()).map(([provider, providerModels]) => ({
    provider,
    models: providerModels,
  }));
}

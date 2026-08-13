import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import type {
  CredentialInfo,
  CustomProviderConfig,
  CustomProviderModel,
  LlmTestResult,
  ProviderStatus,
  ProviderStatusKind,
} from '@finagent/core';
import {
  groupModelsByProvider,
  llmModelsAtom,
  llmStateAtom,
  refreshLlmProvidersAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { ModelSelector } from '../agent/ModelSelector';
import { ThinkingSelector } from '../agent/ThinkingSelector';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
    {children}
  </section>
);

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const statusBadge = (status: ProviderStatusKind): { label: string; className: string } => {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        className: 'border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10 text-[var(--mac-green)]',
      };
    case 'missing_credential':
      return {
        label: 'Missing Credential',
        className: 'border-[var(--mac-yellow)]/30 bg-[var(--mac-yellow)]/10 text-[var(--mac-yellow)]',
      };
    case 'unavailable':
      return {
        label: 'Unavailable',
        className: 'border-[var(--mac-red)]/30 bg-[var(--mac-red)]/10 text-[var(--mac-red)]',
      };
    case 'runtime_error':
      return {
        label: 'Runtime Error',
        className: 'border-[var(--mac-red)]/30 bg-[var(--mac-red)]/10 text-[var(--mac-red)]',
      };
  }
};

const emptyCustomForm = {
  name: '',
  displayName: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  modelName: '',
  contextWindow: '',
  reasoning: false,
};

/** Core LLM settings: runtime/model, reasoning, providers, credentials, custom providers. */
export const ModelsTab: React.FC = () => {
  const client = useFinagentClient();
  const [llmState] = useAtom(llmStateAtom);
  const [models] = useAtom(llmModelsAtom);
  const refreshProviders = useSetAtom(refreshLlmProvidersAtom);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [credentialBusy, setCredentialBusy] = useState<Record<string, boolean>>({});
  const [credentialErrors, setCredentialErrors] = useState<Record<string, string>>({});
  const [testBusy, setTestBusy] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({});

  const [customForm, setCustomForm] = useState(emptyCustomForm);
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSuccess, setCustomSuccess] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    setProvidersError(null);
    const [p, c] = await Promise.all([client.llm.getProviders(), client.llm.listCredentials()]);
    if (p.ok) setProviders(p.data);
    else setProvidersError(p.error.message);
    if (c.ok) setCredentials(c.data);
    setLoadingProviders(false);
  }, [client]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const testModelIdFor = (provider: string): string | null => {
    const current = llmState.model;
    if (current && current.provider === provider) return current.id;
    const group = groupModelsByProvider(models).find((g) => g.provider === provider);
    return group?.models[0]?.id ?? null;
  };

  const isCredentialConfigured = (provider: string): boolean =>
    credentials.some((c) => c.provider === provider && c.configured);

  const saveCredential = async (provider: string) => {
    const key = (credentialInputs[provider] ?? '').trim();
    if (!key) return;
    setCredentialBusy((b) => ({ ...b, [provider]: true }));
    setCredentialErrors((e) => ({ ...e, [provider]: '' }));
    const result = await client.llm.setCredential(provider, key);
    setCredentialBusy((b) => ({ ...b, [provider]: false }));
    if (result.ok) {
      setCredentialInputs((i) => ({ ...i, [provider]: '' }));
      await loadProviders();
    } else {
      setCredentialErrors((e) => ({ ...e, [provider]: result.error.message }));
    }
  };

  const removeCredential = async (provider: string) => {
    setCredentialBusy((b) => ({ ...b, [provider]: true }));
    const result = await client.llm.removeCredential(provider);
    setCredentialBusy((b) => ({ ...b, [provider]: false }));
    if (result.ok) {
      await loadProviders();
    } else {
      setCredentialErrors((e) => ({ ...e, [provider]: result.error.message }));
    }
  };

  const testProvider = async (provider: string) => {
    const modelId = testModelIdFor(provider);
    if (!modelId) return;
    setTestBusy((b) => ({ ...b, [provider]: true }));
    const result = await client.llm.testProvider(provider, modelId);
    setTestBusy((b) => ({ ...b, [provider]: false }));
    if (result.ok) {
      setTestResults((r) => ({ ...r, [provider]: result.data }));
    } else {
      setTestResults((r) => ({
        ...r,
        [provider]: { ok: false, message: result.error.message, provider, modelId },
      }));
    }
  };

  const submitCustomProvider = async () => {
    const { name, displayName, baseUrl, apiKey, modelId, modelName, contextWindow, reasoning } =
      customForm;
    setCustomError(null);
    setCustomSuccess(null);
    if (!name.trim() || !baseUrl.trim() || !modelId.trim()) {
      setCustomError('Name, Base URL, and Model ID are required.');
      return;
    }
    const model: CustomProviderModel = {
      id: modelId.trim(),
      name: modelName.trim() || modelId.trim(),
      ...(contextWindow.trim() ? { contextWindow: Number(contextWindow) } : {}),
      ...(reasoning ? { reasoning: true } : {}),
    };
    const config: CustomProviderConfig = {
      name: name.trim(),
      displayName: displayName.trim() || name.trim(),
      baseUrl: baseUrl.trim(),
      api: 'openai-completions',
      ...(apiKey ? { apiKey } : {}),
      models: [model],
    };
    setCustomBusy(true);
    const result = await client.llm.setCustomProvider(config);
    setCustomBusy(false);
    if (result.ok) {
      setCustomForm(emptyCustomForm);
      setCustomSuccess('Custom provider added.');
      await loadProviders();
      void refreshProviders(client);
    } else {
      setCustomError(result.error.message);
    }
  };

  const removeCustomProvider = async (name: string) => {
    const result = await client.llm.removeCustomProvider(name);
    if (result.ok) {
      await loadProviders();
      void refreshProviders(client);
    }
  };

  const customProviders = credentials.filter((c) => c.custom === true);
  const currentModel = llmState.model;

  return (
    <div className="max-w-2xl space-y-8">
      <Section title="Runtime & default model">
        <div className="mac-stock-tile rounded-[14px] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] text-foreground/54">Agent runtime</span>
            <span className="text-[12px] font-semibold text-foreground">{llmState.runtimeProvider}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ModelSelector />
            <ThinkingSelector />
          </div>
          {currentModel && (
            <div className="mt-3 border-t mac-section-divider pt-3 text-[12px] text-foreground/54">
              Active model: <span className="font-medium text-foreground">{currentModel.name || `${currentModel.provider}/${currentModel.id}`}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Provider status">
        <div className="mac-stock-tile rounded-[14px] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] text-foreground/54">
              {loadingProviders ? 'Loading providers…' : `${providers.length} providers`}
            </span>
            <button
              type="button"
              onClick={() => void loadProviders()}
              disabled={loadingProviders}
              className="mac-secondary-button flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-medium text-foreground transition-smooth disabled:opacity-50"
            >
              {loadingProviders ? <Spinner /> : null}
              Refresh
            </button>
          </div>
          {providersError && <div className="mb-3 text-[12px] text-destructive">{providersError}</div>}
          <div className="space-y-2">
            {!loadingProviders &&
              providers.map((provider) => {
                const badge = statusBadge(provider.status);
                return (
                  <div key={provider.provider} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {provider.displayName || provider.provider}
                      </div>
                      {provider.message && (
                        <div className="truncate text-[11px] text-foreground/48">{provider.message}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {provider.modelCount != null && (
                        <span className="text-[11px] text-foreground/42">{provider.modelCount} models</span>
                      )}
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            {!loadingProviders && providers.length === 0 && !providersError && (
              <div className="text-[12px] text-foreground/48">No providers configured</div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Credentials">
        <div className="mac-stock-tile rounded-[14px] p-4">
          {providers.length === 0 && !loadingProviders ? (
            <div className="text-[12px] text-foreground/48">No providers available</div>
          ) : (
            <div className="space-y-4">
              {providers.map((provider) => {
                const id = provider.provider;
                const busy = credentialBusy[id] ?? false;
                const testing = testBusy[id] ?? false;
                const testResult = testResults[id];
                const modelId = testModelIdFor(id);
                return (
                  <div key={id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-foreground">
                        {provider.displayName || id}
                      </span>
                      {isCredentialConfigured(id) && (
                        <span className="text-[11px] font-semibold text-[var(--mac-green)]">Configured</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={credentialInputs[id] ?? ''}
                        onChange={(e) =>
                          setCredentialInputs((i) => ({ ...i, [id]: e.target.value }))
                        }
                        placeholder="API key"
                        className="mac-input h-8 flex-1 rounded-[10px] px-3 text-[12px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28"
                      />
                      <button
                        type="button"
                        onClick={() => void saveCredential(id)}
                        disabled={busy || !(credentialInputs[id] ?? '').trim()}
                        className="mac-primary-button h-8 rounded-[10px] px-3 text-[12px] font-semibold transition-smooth disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {busy ? <Spinner /> : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeCredential(id)}
                        disabled={busy || !isCredentialConfigured(id)}
                        className="mac-secondary-button h-8 rounded-[10px] px-3 text-[12px] font-medium text-foreground transition-smooth disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => void testProvider(id)}
                        disabled={testing || !modelId}
                        className="mac-secondary-button flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-medium text-foreground transition-smooth disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {testing ? <Spinner /> : null}
                        Test
                      </button>
                    </div>
                    {credentialErrors[id] && (
                      <div className="text-[11px] text-destructive">{credentialErrors[id]}</div>
                    )}
                    {testResult && (
                      <div
                        className={`text-[11px] ${
                          testResult.ok ? 'text-[var(--mac-green)]' : 'text-destructive'
                        }`}
                      >
                        {testResult.ok ? '✓' : '✗'} {testResult.message}
                        {testResult.ok && testResult.latencyMs != null && (
                          <span className="text-foreground/48"> · {testResult.latencyMs}ms</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <Section title="Custom providers">
        <div className="mac-stock-tile space-y-3 rounded-[14px] p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" value={customForm.name} onChange={(v) => setCustomForm((f) => ({ ...f, name: v }))} placeholder="my-provider" />
            <Field label="Display name" value={customForm.displayName} onChange={(v) => setCustomForm((f) => ({ ...f, displayName: v }))} placeholder="My Provider" />
            <Field label="Base URL" value={customForm.baseUrl} onChange={(v) => setCustomForm((f) => ({ ...f, baseUrl: v }))} placeholder="https://api.example.com/v1" className="col-span-2" />
            <Field label="API key" type="password" value={customForm.apiKey} onChange={(v) => setCustomForm((f) => ({ ...f, apiKey: v }))} placeholder="sk-…" />
            <Field label="Context window (optional)" value={customForm.contextWindow} onChange={(v) => setCustomForm((f) => ({ ...f, contextWindow: v }))} placeholder="128000" />
            <Field label="Model ID" value={customForm.modelId} onChange={(v) => setCustomForm((f) => ({ ...f, modelId: v }))} placeholder="model-id" />
            <Field label="Model display name" value={customForm.modelName} onChange={(v) => setCustomForm((f) => ({ ...f, modelName: v }))} placeholder="My Model" />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-foreground/72">
            <input
              type="checkbox"
              checked={customForm.reasoning}
              onChange={(e) => setCustomForm((f) => ({ ...f, reasoning: e.target.checked }))}
              className="accent-[var(--mac-blue)]"
            />
            Reasoning model
          </label>
          {customError && <div className="text-[11px] text-destructive">{customError}</div>}
          {customSuccess && <div className="text-[11px] text-[var(--mac-green)]">{customSuccess}</div>}
          <button
            type="button"
            onClick={() => void submitCustomProvider()}
            disabled={customBusy}
            className="mac-primary-button flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition-smooth disabled:cursor-not-allowed disabled:opacity-45"
          >
            {customBusy ? <Spinner /> : null}
            Add custom provider
          </button>

          {customProviders.length > 0 && (
            <div className="space-y-1.5 border-t mac-section-divider pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/42">
                Existing custom providers
              </div>
              {customProviders.map((cred) => (
                <div key={cred.provider} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-foreground">{cred.provider}</span>
                  <button
                    type="button"
                    onClick={() => void removeCustomProvider(cred.provider)}
                    className="mac-secondary-button h-8 rounded-[10px] px-3 text-[12px] font-medium text-foreground transition-smooth"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, type = 'text', placeholder, className }) => (
  <label className={`flex flex-col gap-1 ${className ?? ''}`}>
    <span className="text-[11px] font-medium text-foreground/54">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mac-input h-8 rounded-[10px] px-3 text-[12px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28"
    />
  </label>
);

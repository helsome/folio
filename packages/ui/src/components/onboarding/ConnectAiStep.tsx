import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import type { LlmTestResult, ProviderStatus } from '@finagent/core';
import {
  llmCredentialsAtom,
  llmProvidersAtom,
  llmStateAtom,
  refreshLlmProvidersAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { ModelSelector } from '../agent/ModelSelector';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** Connect AI (spec §29): provider + credential + model. Reuses the LLM atoms. */
export const ConnectAiStep: React.FC = () => {
  const client = useFinagentClient();
  const [state] = useAtom(llmStateAtom);
  const [providers] = useAtom(llmProvidersAtom);
  const [credentials] = useAtom(llmCredentialsAtom);
  const refreshProviders = useSetAtom(refreshLlmProvidersAtom);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, LlmTestResult>>({});

  useEffect(() => {
    void refreshProviders(client);
  }, [client, refreshProviders]);

  const configured = (provider: string): boolean =>
    credentials.some((cred) => cred.provider === provider && cred.configured);

  const saveCredential = useCallback(
    async (provider: string) => {
      const key = (inputs[provider] ?? '').trim();
      if (!key) return;
      setBusy((b) => ({ ...b, [provider]: true }));
      setErrors((e) => ({ ...e, [provider]: '' }));
      const result = await client.llm.setCredential(provider, key);
      setBusy((b) => ({ ...b, [provider]: false }));
      if (result.ok) {
        setInputs((i) => ({ ...i, [provider]: '' }));
        await refreshProviders(client);
      } else {
        setErrors((e) => ({ ...e, [provider]: result.error.message }));
      }
    },
    [client, inputs, refreshProviders]
  );

  const testProvider = useCallback(
    async (provider: string) => {
      const modelId = state.model && state.model.provider === provider ? state.model.id : null;
      setBusy((b) => ({ ...b, [provider]: true }));
      const result = await client.llm.testProvider(provider, modelId ?? '');
      setBusy((b) => ({ ...b, [provider]: false }));
      if (result.ok) {
        setTests((t) => ({ ...t, [provider]: result.data }));
      } else {
        setTests((t) => ({
          ...t,
          [provider]: { ok: false, message: result.error.message, provider, modelId: modelId ?? '' },
        }));
      }
    },
    [client, state.model]
  );

  const activeModel = state.model;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold text-foreground">Connect AI</h2>
        <p className="text-[13px] text-foreground/66">
          Choose an LLM provider, add its credential, and pick a model.
        </p>
      </div>

      <div className="rounded-[10px] border mac-section-divider p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-foreground">Model</span>
          {activeModel && (
            <span className="text-[11px] font-semibold text-[var(--mac-green)]">
              ✓ {activeModel.name || `${activeModel.provider}/${activeModel.id}`}
            </span>
          )}
        </div>
        <ModelSelector />
      </div>

      <div className="space-y-2">
        <div className="text-[12px] font-semibold text-foreground">Providers & credentials</div>
        {providers.length === 0 ? (
          <div className="text-[12px] text-foreground/48">Loading providers…</div>
        ) : (
          providers.map((provider: ProviderStatus) => {
            const id = provider.provider;
            const saving = busy[id] ?? false;
            const testResult = tests[id];
            return (
              <div key={id} className="rounded-[10px] border mac-section-divider p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-foreground">
                    {provider.displayName || id}
                  </span>
                  {configured(id) && (
                    <span className="text-[11px] font-semibold text-[var(--mac-green)]">Configured</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="password"
                    value={inputs[id] ?? ''}
                    onChange={(event) => setInputs((i) => ({ ...i, [id]: event.target.value }))}
                    placeholder="API key"
                    autoComplete="off"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={() => void saveCredential(id)} disabled={saving || !(inputs[id] ?? '').trim()}>
                    {saving ? <Spinner /> : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void testProvider(id)} disabled={saving}>
                    Test
                  </Button>
                </div>
                {errors[id] && <div className="mt-1.5 text-[11px] text-destructive">{errors[id]}</div>}
                {testResult && (
                  <div className={`mt-1.5 text-[11px] ${testResult.ok ? 'text-[var(--mac-green)]' : 'text-destructive'}`}>
                    {testResult.ok ? '✓' : '✗'} {testResult.message}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

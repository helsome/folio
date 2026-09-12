import React from 'react';
import { createRoot } from 'react-dom/client';
import type { EvaluationSettings, LangfuseConnectionStatus, LangSmithConnectionStatus } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type EvaluationChannel, type FinagentClient } from '../../../packages/ui/src/client';
import { I18nProvider } from '../../../packages/ui/src/i18n/I18nProvider';
import { EvaluationSettingsTab } from '../../../packages/ui/src/components/settings/EvaluationSettingsTab';
import { TooltipProvider } from '../../../packages/ui/src/components/ui/tooltip';
import '../../../apps/electron/src/renderer/styles/index.css';

function mockClient(
  settings: EvaluationSettings,
  langfuse: LangfuseConnectionStatus,
  connection: LangSmithConnectionStatus = { connected: false, configured: false }
): FinagentClient {
  return {
    ...fallbackClient,
    evaluation: {
      ...fallbackClient.evaluation,
      getSettings: async () => ({ ok: true, data: { settings, connection, langfuse } }),
    } as EvaluationChannel,
  };
}

const connectedSettings: EvaluationSettings = {
  tracingEnabled: false,
  langsmithProject: 'folio-agent',
  langsmithEndpoint: '',
  langfuseTracingEnabled: true,
  langfuseHost: 'https://cloud.langfuse.com',
  langfuseConfigured: true,
  privacyLevel: 'standard',
  onlineEvaluationEnabled: false,
  apiKeyConfigured: false,
  updatedAt: Date.now(),
};

const emptySettings: EvaluationSettings = {
  ...connectedSettings,
  langfuseTracingEnabled: false,
  langfuseHost: '',
  langfuseConfigured: false,
};

const Preview: React.FC = () => (
  <div className="min-h-screen bg-background px-8 py-10 text-foreground">
    <div className="mx-auto flex max-w-[720px] flex-col gap-10">
      <section data-preview="langfuse-connected">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
          Settings → Evaluation · Langfuse connected
        </p>
        <FinagentClientProvider
          client={mockClient(connectedSettings, {
            connected: true,
            configured: true,
            endpoint: 'https://cloud.langfuse.com',
            message: 'Connected.',
          })}
        >
          <I18nProvider>
            <TooltipProvider>
              <EvaluationSettingsTab />
            </TooltipProvider>
          </I18nProvider>
        </FinagentClientProvider>
      </section>
      <section data-preview="langfuse-empty">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
          Settings → Evaluation · Langfuse not configured
        </p>
        <FinagentClientProvider
          client={mockClient(emptySettings, { connected: false, configured: false })}
        >
          <I18nProvider>
            <TooltipProvider>
              <EvaluationSettingsTab />
            </TooltipProvider>
          </I18nProvider>
        </FinagentClientProvider>
      </section>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(<Preview />);

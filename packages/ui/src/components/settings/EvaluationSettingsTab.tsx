import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import type { EvaluationSettings, LangSmithConnectionStatus, PrivacyLevel } from '@finagent/core';
import { useFinagentClient } from '../../client';
import { Button } from '../primitives/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/**
 * Settings → Evaluation (spec §61–63, §56–59): LangSmith observability
 * connection. The renderer never sees the API key — only whether one is
 * configured and when it was last updated (spec §12, §63).
 */

const DEFAULT_LANGSMITH_UI = 'https://smith.langchain.com';
const ENDPOINT_PLACEHOLDER = 'https://api.smith.langchain.com';

const PRIVACY_LEVELS: Array<{ id: PrivacyLevel; label: string; hint: string }> = [
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'No prompts, answers, or tool payloads in traces — names, status, and durations only.',
  },
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Prompts, answers, and tool arguments recorded after redaction; portfolio results reduced to schema summaries.',
  },
  {
    id: 'full',
    label: 'Full',
    hint: 'Complete trace — explicit opt-in. Credentials and tokens are still redacted.',
  },
];

const Spinner: React.FC = () => (
  <svg className="h-3.5 w-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const fieldClass =
  'mac-input h-8 w-full rounded-[10px] px-3 text-[12px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28';

function formatUpdated(updatedAt: number): string {
  return new Date(updatedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const EvaluationSettingsTab: React.FC = () => {
  const client = useFinagentClient();
  const channelAvailable = typeof client.evaluation?.getSettings === 'function';

  const [settings, setSettings] = useState<EvaluationSettings | null>(null);
  const [connection, setConnection] = useState<LangSmithConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const [project, setProject] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>('standard');

  const [tracingBusy, setTracingBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await client.evaluation?.getSettings();
    if (!result || !result.ok) {
      if (result && result.error.code === 'CLIENT_UNAVAILABLE') {
        setUnavailable(true);
      } else {
        setLoadError(result?.error.message ?? 'Failed to load evaluation settings.');
      }
      setLoading(false);
      return;
    }
    setUnavailable(false);
    setSettings(result.data.settings);
    setConnection(result.data.connection);
    setProject(result.data.settings.langsmithProject);
    setEndpoint(result.data.settings.langsmithEndpoint);
    setPrivacyLevel(result.data.settings.privacyLevel);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setTracing = async (enabled: boolean) => {
    if (!settings) return;
    setTracingBusy(true);
    setSaveError(null);
    const result = await client.evaluation?.setSettings({ tracingEnabled: enabled });
    if (result?.ok) {
      setSettings(result.data);
    } else {
      setSaveError(result?.error.message ?? 'Could not update tracing.');
    }
    setTracingBusy(false);
  };

  const saveSettings = async () => {
    setSaveBusy(true);
    setSaveError(null);
    setSaveSuccess(null);
    const result = await client.evaluation?.setSettings({
      langsmithProject: project.trim(),
      langsmithEndpoint: endpoint.trim(),
      privacyLevel,
    });
    if (result?.ok) {
      setSettings(result.data);
      setSaveSuccess('Settings saved.');
    } else {
      setSaveError(result?.error.message ?? 'Could not save settings.');
    }
    setSaveBusy(false);
  };

  const testConnection = async () => {
    setTestBusy(true);
    setTestResult(null);
    const result = await client.evaluation?.testConnection();
    if (result?.ok) {
      const status = result.data;
      setConnection(status);
      if (status.connected) {
        setTestResult({
          ok: true,
          message: status.project ? `Connected to “${status.project}”.` : 'Connected.',
        });
      } else {
        setTestResult({
          ok: false,
          message: status.error ?? status.message ?? 'Not connected.',
        });
      }
    } else {
      setTestResult({ ok: false, message: result?.error.message ?? 'Connection test failed.' });
    }
    setTestBusy(false);
  };

  const openLangSmith = async () => {
    const target = connection?.endpoint?.trim() || endpoint.trim() || DEFAULT_LANGSMITH_UI;
    await client.openExternal?.(target);
  };

  const saveApiKey = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setKeyBusy(true);
    setKeyError(null);
    const result = await client.evaluation?.setCredential(key);
    if (result?.ok) {
      setApiKey('');
      await refresh();
    } else {
      setKeyError(result?.error.message ?? 'Could not save API key.');
    }
    setKeyBusy(false);
  };

  const removeApiKey = async () => {
    setKeyBusy(true);
    setKeyError(null);
    const result = await client.evaluation?.removeCredential();
    if (result?.ok) {
      setApiKey('');
      await refresh();
    } else {
      setKeyError(result?.error.message ?? 'Could not remove API key.');
    }
    setKeyBusy(false);
  };

  if (!channelAvailable) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          The evaluation channel isn&apos;t wired into this build yet — this tab will populate once the
          Evaluation IPC lands.
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-[12px] text-foreground/48">Loading evaluation settings…</div>;
  }

  if (unavailable) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          Evaluation settings aren&apos;t available yet — the evaluation channel is not wired.
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
          {loadError ?? 'Evaluation settings are unavailable.'}
        </div>
      </div>
    );
  }

  const connected = connection?.connected ?? false;
  const configured = settings.apiKeyConfigured;
  const hasKeyHint = configured
    ? `Configured • updated ${formatUpdated(settings.updatedAt)}`
    : 'Not configured';
  const statusBadge = connected
    ? { label: 'Connected', className: 'border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10 text-[var(--mac-green)]' }
    : connection?.error
      ? { label: 'Error', className: 'border-destructive/30 bg-destructive/10 text-destructive' }
      : { label: 'Not Configured', className: 'border-[var(--mac-yellow)]/40 bg-[var(--mac-yellow)]/10 text-[var(--mac-yellow)]' };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="mac-stock-tile rounded-[14px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">LangSmith Connection</h2>
            <p className="mt-1 text-[12px] text-foreground/48">
              Agent tracing for evaluation experiments (spec §61). Traces never leave your machine
              unless you enable them.
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </div>

        {connection?.error && (
          <div className="mt-3 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-foreground/78">
            {connection.error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-foreground">Tracing</div>
            <div className="mt-0.5 text-[11px] text-foreground/48">
              {configured
                ? 'Record agent runs to LangSmith for review.'
                : 'Add an API key below to enable tracing.'}
            </div>
          </div>
          <Switch
            checked={settings.tracingEnabled}
            disabled={tracingBusy || !configured}
            onCheckedChange={(value) => void setTracing(value)}
            aria-label="Toggle agent tracing"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-foreground/54">Project</span>
            <input
              className={fieldClass}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="folio-agent"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-foreground/54">
              Endpoint <span className="text-foreground/36">(optional)</span>
            </span>
            <input
              className={fieldClass}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={ENDPOINT_PLACEHOLDER}
              spellCheck={false}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-[11px] font-medium text-foreground/54">
              Privacy level
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex h-3.5 w-3.5 cursor-help items-center justify-center text-foreground/36">
                    <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px]">
                  {PRIVACY_LEVELS.find((level) => level.id === privacyLevel)?.hint}
                </TooltipContent>
              </Tooltip>
            </span>
            <div className="w-44">
              <Select value={privacyLevel} onValueChange={(value) => setPrivacyLevel(value as PrivacyLevel)}>
                <SelectTrigger aria-label="Privacy level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIVACY_LEVELS.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" disabled={saveBusy} onClick={() => void saveSettings()}>
              {saveBusy ? <Spinner /> : null}
              Save settings
            </Button>
            <Button variant="secondary" size="sm" disabled={testBusy} onClick={() => void testConnection()}>
              {testBusy ? <Spinner /> : null}
              Test Connection
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openLangSmith()}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open LangSmith
            </Button>
          </div>
        </div>

        {saveError && <div className="mt-3 text-[11px] text-destructive">{saveError}</div>}
        {saveSuccess && <div className="mt-3 text-[11px] text-[var(--mac-green)]">{saveSuccess}</div>}
        {testResult && (
          <div className={`mt-3 text-[11px] ${testResult.ok ? 'text-[var(--mac-green)]' : 'text-destructive'}`}>
            {testResult.ok ? '✓' : '✗'} {testResult.message}
          </div>
        )}
      </div>

      <div className="mac-stock-tile rounded-[14px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">API Key</h2>
            <p className="mt-1 text-[12px] text-foreground/48">
              {hasKeyHint} — the key itself is never shown or read back.
            </p>
          </div>
          <span className={`shrink-0 text-[11px] font-semibold ${configured ? 'text-[var(--mac-green)]' : 'text-foreground/44'}`}>
            {configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            type="password"
            className={`${fieldClass} flex-1`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="lsv2_…"
            autoComplete="off"
          />
          <Button variant="default" size="sm" disabled={keyBusy || !apiKey.trim()} onClick={() => void saveApiKey()}>
            {keyBusy ? <Spinner /> : null}
            Save
          </Button>
          <Button variant="secondary" size="sm" disabled={keyBusy || !configured} onClick={() => void removeApiKey()}>
            Remove
          </Button>
        </div>
        {keyError && <div className="mt-3 text-[11px] text-destructive">{keyError}</div>}
      </div>
    </div>
  );
};

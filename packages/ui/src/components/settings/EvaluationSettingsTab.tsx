import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const PRIVACY_LEVELS: Array<{ id: PrivacyLevel; labelKey: string; hintKey: string }> = [
  { id: 'minimal', labelKey: 'settings.evaluation.privacyMinimal', hintKey: 'settings.evaluation.privacyMinimalHint' },
  { id: 'standard', labelKey: 'settings.evaluation.privacyStandard', hintKey: 'settings.evaluation.privacyStandardHint' },
  { id: 'full', labelKey: 'settings.evaluation.privacyFull', hintKey: 'settings.evaluation.privacyFullHint' },
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
  const { t } = useTranslation();
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
        setLoadError(result?.error.message ?? t('settings.evaluation.failedToLoad'));
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
  }, [client, t]);

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
      setSaveError(result?.error.message ?? t('settings.evaluation.couldNotUpdateTracing'));
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
      setSaveSuccess(t('settings.evaluation.settingsSaved'));
    } else {
      setSaveError(result?.error.message ?? t('settings.evaluation.couldNotSaveSettings'));
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
          message: status.project ? t('settings.evaluation.connectedTo', { project: status.project }) : t('settings.evaluation.connectedShort'),
        });
      } else {
        setTestResult({
          ok: false,
          message: status.error ?? status.message ?? t('settings.evaluation.notConnected'),
        });
      }
    } else {
      setTestResult({ ok: false, message: result?.error.message ?? t('settings.evaluation.connectionTestFailed') });
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
      setKeyError(result?.error.message ?? t('settings.evaluation.couldNotSaveApiKey'));
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
      setKeyError(result?.error.message ?? t('settings.evaluation.couldNotRemoveApiKey'));
    }
    setKeyBusy(false);
  };

  if (!channelAvailable) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          {t('settings.evaluation.channelNotWired')}
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-[12px] text-foreground/48">{t('settings.evaluation.loading')}</div>;
  }

  if (unavailable) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          {t('settings.evaluation.channelNotAvailable')}
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
          {loadError ?? t('settings.evaluation.unavailable')}
        </div>
      </div>
    );
  }

  const connected = connection?.connected ?? false;
  const configured = settings.apiKeyConfigured;
  const hasKeyHint = configured
    ? t('settings.evaluation.keyHintConfigured', { date: formatUpdated(settings.updatedAt) })
    : t('settings.evaluation.notConfiguredLower');
  const statusBadge = connected
    ? { labelKey: 'settings.evaluation.connected', className: 'border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10 text-[var(--mac-green)]' }
    : connection?.error
      ? { labelKey: 'settings.evaluation.error', className: 'border-destructive/30 bg-destructive/10 text-destructive' }
      : { labelKey: 'settings.evaluation.notConfigured', className: 'border-[var(--mac-yellow)]/40 bg-[var(--mac-yellow)]/10 text-[var(--mac-yellow)]' };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="mac-stock-tile rounded-[14px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">{t('settings.evaluation.langsmithConnection')}</h2>
            <p className="mt-1 text-[12px] text-foreground/48">
              {t('settings.evaluation.langsmithDesc')}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
            {t(statusBadge.labelKey)}
          </span>
        </div>

        {connection?.error && (
          <div className="mt-3 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-foreground/78">
            {connection.error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-foreground">{t('settings.evaluation.tracing')}</div>
            <div className="mt-0.5 text-[11px] text-foreground/48">
              {configured
                ? t('settings.evaluation.tracingEnabledDesc')
                : t('settings.evaluation.tracingDisabledDesc')}
            </div>
          </div>
          <Switch
            checked={settings.tracingEnabled}
            disabled={tracingBusy || !configured}
            onCheckedChange={(value) => void setTracing(value)}
            aria-label={t('settings.evaluation.toggleTracingAria')}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-foreground/54">{t('settings.evaluation.project')}</span>
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
              {t('settings.evaluation.endpoint')} <span className="text-foreground/36">{t('settings.evaluation.optional')}</span>
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
              {t('settings.evaluation.privacyLevel')}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex h-3.5 w-3.5 cursor-help items-center justify-center text-foreground/36">
                    <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px]">
                  {t(PRIVACY_LEVELS.find((level) => level.id === privacyLevel)?.hintKey ?? '')}
                </TooltipContent>
              </Tooltip>
            </span>
            <div className="w-44">
              <Select value={privacyLevel} onValueChange={(value) => setPrivacyLevel(value as PrivacyLevel)}>
                <SelectTrigger aria-label={t('settings.evaluation.privacyLevel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIVACY_LEVELS.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {t(level.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" disabled={saveBusy} onClick={() => void saveSettings()}>
              {saveBusy ? <Spinner /> : null}
              {t('settings.evaluation.saveSettings')}
            </Button>
            <Button variant="secondary" size="sm" disabled={testBusy} onClick={() => void testConnection()}>
              {testBusy ? <Spinner /> : null}
              {t('settings.evaluation.testConnection')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openLangSmith()}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t('settings.evaluation.openLangSmith')}
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
            <h2 className="text-[14px] font-semibold text-foreground">{t('settings.evaluation.apiKey')}</h2>
            <p className="mt-1 text-[12px] text-foreground/48">
              {t('settings.evaluation.apiKeyHint', { keyHint: hasKeyHint })}
            </p>
          </div>
          <span className={`shrink-0 text-[11px] font-semibold ${configured ? 'text-[var(--mac-green)]' : 'text-foreground/44'}`}>
            {configured ? t('settings.evaluation.configured') : t('settings.evaluation.notConfiguredLower')}
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
            {t('settings.evaluation.save')}
          </Button>
          <Button variant="secondary" size="sm" disabled={keyBusy || !configured} onClick={() => void removeApiKey()}>
            {t('settings.evaluation.remove')}
          </Button>
        </div>
        {keyError && <div className="mt-3 text-[11px] text-destructive">{keyError}</div>}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinancialProviderStatus } from '@finagent/core';
import { useFinagentClient } from '../../client';
import {
  connectProvider,
  connectionStatusLabel,
  disconnectProvider,
  hasOpenExternal,
  openExternalUrl,
  quoteAccessSummary,
  setProviderConfig,
  testProvider,
  type ConnectionEntry,
  type ConnectionKind,
} from '../../client/connections';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';

/** Official Longbridge setup docs (never curl|sh from the renderer). */
const LONGBRIDGE_SETUP_URL = 'https://open.longbridge.com/skill/install.md';

const KIND_LABEL_KEY: Record<ConnectionKind, string> = {
  'financial-data': 'connections.kindFinancialData',
  'broker-account': 'connections.kindBrokerAccount',
};

const STATUS_DOT: Record<FinancialProviderStatus, string> = {
  'not-installed': 'bg-foreground/30',
  'not-connected': 'bg-foreground/40',
  connecting: 'bg-[var(--mac-yellow)] animate-pulse',
  connected: 'bg-[var(--mac-green)]',
  'permission-limited': 'bg-[var(--mac-yellow)]',
  expired: 'bg-[var(--mac-yellow)]',
  error: 'bg-[var(--mac-red)]',
};

type BusyAction = 'connect' | 'disconnect' | 'test' | 'setConfig';

/** A single provider connection card: status, actions, and the device/BYOK flows. */
export const ConnectionCard: React.FC<{
  entry: ConnectionEntry;
  onChanged: () => void;
}> = ({ entry, onChanged }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Device-flow state (longbridge).
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);

  // BYOK state (massive).
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const [testSummary, setTestSummary] = useState<string | null>(null);

  const waiting = verificationUrl !== null || entry.status === 'connecting';

  // When the pushed list reports a terminal status, drop the local device state.
  useEffect(() => {
    if (entry.status !== 'connecting') {
      setVerificationUrl(null);
    }
  }, [entry.status]);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async (action: BusyAction, task: () => Promise<{ ok: boolean; error: string | null }>) => {
      setBusy(action);
      setError(null);
      const result = await task();
      setBusy(null);
      if (!result.ok && result.error) {
        setError(result.error);
      }
    },
    []
  );

  const handleDeviceConnect = useCallback(async () => {
    setBusy('connect');
    setError(null);
    const result = await connectProvider(client, entry.providerId);
    setBusy(null);
    if (result.ok && result.data) {
      if (result.data.status === 'connecting') {
        setVerificationUrl(result.data.verificationUrl ?? null);
      }
      onChanged();
    } else {
      setError(result.error?.message ?? t('connections.connectionFailed'));
    }
  }, [client, entry.providerId, onChanged, t]);

  const handleConnect = useCallback(() => {
    if (entry.configurable) {
      setShowApiKey(true);
      setError(null);
      return;
    }
    void handleDeviceConnect();
  }, [entry.configurable, handleDeviceConnect]);

  const handleSaveKey = useCallback(async () => {
    const key = apiKey.trim();
    if (!key) {
      setError(t('connections.enterApiKeyError'));
      return;
    }
    await run('setConfig', async () => {
      const result = await setProviderConfig(client, entry.providerId, { apiKey: key });
      if (result.ok) {
        setApiKey('');
        setShowApiKey(false);
        setTestSummary(null);
        onChanged();
        return { ok: true, error: null };
      }
      return { ok: false, error: result.error?.message ?? t('connections.saveApiKeyFailed') };
    });
  }, [apiKey, client, entry.providerId, onChanged, run, t]);

  const handleDisconnect = useCallback(() => {
    void run('disconnect', async () => {
      const result = await disconnectProvider(client, entry.providerId);
      if (result.ok) {
        onChanged();
        return { ok: true, error: null };
      }
      return { ok: false, error: result.error?.message ?? t('connections.disconnectFailed') };
    });
  }, [client, entry.providerId, onChanged, run, t]);

  const handleTest = useCallback(() => {
    void run('test', async () => {
      const result = await testProvider(client, entry.providerId);
      if (result.ok && result.data) {
        const health = result.data;
        const latency = health.latencyMs != null ? ` · ${health.latencyMs}ms` : '';
        setTestSummary(`${connectionStatusLabel(health.status)}${latency}`);
        return { ok: true, error: null };
      }
      return { ok: false, error: result.error?.message ?? t('connections.testFailed') };
    });
  }, [client, entry.providerId, run, t]);

  const handleCancel = useCallback(() => {
    setVerificationUrl(null);
    setError(null);
    onChanged();
  }, [onChanged]);

  const handleInstall = useCallback(() => {
    void openExternalUrl(client, LONGBRIDGE_SETUP_URL);
  }, [client]);

  const status = entry.status;
  const accountLabel = entry.accountLabel ?? entry.health?.account ?? null;
  const quoteAccess = quoteAccessSummary(entry.health?.permissions);
  const portfolioReady = entry.kind === 'broker-account' && status === 'connected';
  const lastCheck = entry.health?.lastCheck;

  const byok = entry.configurable;

  const renderPrimaryAction = () => {
    if (waiting) {
      return (
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={busy !== null}>
          {t('common.cancel')}
        </Button>
      );
    }
    if (status === 'not-installed') {
      return (
        <Button variant="outline" size="sm" onClick={handleInstall}>
          {t('connections.installSetup')}
        </Button>
      );
    }
    if (status === 'not-connected') {
      return (
        <Button size="sm" onClick={handleConnect} disabled={busy !== null} data-testid={`connect-${entry.providerId}`}>
          {busy === 'connect' ? t('connections.connecting') : t('connections.connect')}
        </Button>
      );
    }
    if (status === 'connected') {
      return (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={busy !== null}
            data-testid={`test-${entry.providerId}`}
          >
            {busy === 'test' ? t('connections.testing') : t('connections.testConnection')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
            {busy === 'disconnect' ? t('connections.disconnecting') : t('connections.disconnect')}
          </Button>
        </>
      );
    }
    // permission-limited | expired | error → reconnect + test + disconnect
    return (
      <>
        <Button size="sm" onClick={handleConnect} disabled={busy !== null}>
          {busy === 'connect' ? t('connections.connecting') : t('connections.reconnect')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={busy !== null}
          data-testid={`test-${entry.providerId}`}
        >
          {busy === 'test' ? t('connections.testing') : t('connections.testConnection')}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
          {t('connections.disconnect')}
        </Button>
      </>
    );
  };

  return (
    <div
      className="mac-stock-tile rounded-[14px] p-4"
      data-testid={`connection-card-${entry.providerId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-foreground">{entry.name}</h3>
            <span className="shrink-0 rounded-full border mac-section-divider px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/54">
              {t(KIND_LABEL_KEY[entry.kind])}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
              aria-hidden="true"
              data-testid={`status-dot-${entry.providerId}`}
            />
            <span className="text-[12px] text-foreground/66" data-testid={`status-${entry.providerId}`}>
              {connectionStatusLabel(status)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {renderPrimaryAction()}
        </div>
      </div>

      {(accountLabel || quoteAccess || portfolioReady || lastCheck != null) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t mac-section-divider pt-2.5 text-[11px] text-foreground/54">
          {accountLabel && <span>{accountLabel}</span>}
          {quoteAccess && <span>{quoteAccess}</span>}
          {portfolioReady && <span className="text-[var(--mac-green)]">{t('connections.portfolioReady')}</span>}
          {lastCheck != null && (
            <span className="tabular-nums">{new Date(lastCheck).toLocaleString()}</span>
          )}
        </div>
      )}

      {waiting && (
        <div className="mt-3 rounded-[10px] border border-[var(--mac-yellow)]/30 bg-[var(--mac-yellow)]/10 p-3">
          <div className="text-[12px] font-medium text-foreground">{t('connections.waitingAuthorization')}</div>
          {verificationUrl && (
            <ExternalLink url={verificationUrl} label={t('connections.openVerificationPage')} clientHasOpenExternal={hasOpenExternal(client)} onOpen={() => void openExternalUrl(client, verificationUrl)} />
          )}
          <div className="mt-1.5 text-[11px] text-foreground/48">
            {t('connections.authorizeHint')}
          </div>
        </div>
      )}

      {byok && showApiKey && (
        <div className="mt-3 space-y-2 rounded-[10px] border mac-section-divider p-3">
          <div className="text-[12px] font-medium text-foreground">{t('connections.enterApiKey')}</div>
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('connections.apiKey')}
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void handleSaveKey()} disabled={busy !== null}>
              {busy === 'setConfig' ? t('connections.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowApiKey(false)} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
          </div>
          {byok && (
            <div className="text-[10px] leading-relaxed text-foreground/42">
              {t('connections.byokNote')}
            </div>
          )}
        </div>
      )}

      {testSummary && !error && (
        <div className="mt-2 text-[11px] text-[var(--mac-green)]">✓ {testSummary}</div>
      )}

      {error && (
        <div
          className="mt-3 rounded-[10px] border border-[var(--mac-red)]/30 bg-[var(--mac-red)]/10 px-3 py-2 text-[12px] text-[var(--mac-red)]"
          role="alert"
          data-testid={`connection-error-${entry.providerId}`}
        >
          {error}
          <button
            type="button"
            className="ml-2 underline underline-offset-2"
            onClick={clearError}
            aria-label={t('connections.dismissError')}
          >
            {t('connections.dismiss')}
          </button>
        </div>
      )}
    </div>
  );
};

const ExternalLink: React.FC<{
  url: string;
  label: string;
  clientHasOpenExternal: boolean;
  onOpen: () => void;
}> = ({ url, label, clientHasOpenExternal, onOpen }) => {
  if (clientHasOpenExternal) {
    return (
      <button
        type="button"
        className="text-[12px] font-medium text-accent underline underline-offset-2"
        onClick={onOpen}
      >
        {label}
      </button>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[12px] font-medium text-accent underline underline-offset-2"
    >
      {label}
    </a>
  );
};

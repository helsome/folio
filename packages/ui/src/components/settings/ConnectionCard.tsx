import React, { useCallback, useEffect, useState } from 'react';
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

const KIND_LABEL: Record<ConnectionKind, string> = {
  'financial-data': 'Financial Data',
  'broker-account': 'Broker Account',
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
      setError(result.error?.message ?? 'Connection failed.');
    }
  }, [client, entry.providerId, onChanged]);

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
      setError('Enter an API key.');
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
      return { ok: false, error: result.error?.message ?? 'Could not save the API key.' };
    });
  }, [apiKey, client, entry.providerId, onChanged, run]);

  const handleDisconnect = useCallback(() => {
    void run('disconnect', async () => {
      const result = await disconnectProvider(client, entry.providerId);
      if (result.ok) {
        onChanged();
        return { ok: true, error: null };
      }
      return { ok: false, error: result.error?.message ?? 'Disconnect failed.' };
    });
  }, [client, entry.providerId, onChanged, run]);

  const handleTest = useCallback(() => {
    void run('test', async () => {
      const result = await testProvider(client, entry.providerId);
      if (result.ok && result.data) {
        const health = result.data;
        const latency = health.latencyMs != null ? ` · ${health.latencyMs}ms` : '';
        setTestSummary(`${connectionStatusLabel(health.status)}${latency}`);
        return { ok: true, error: null };
      }
      return { ok: false, error: result.error?.message ?? 'Test failed.' };
    });
  }, [client, entry.providerId, run]);

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
          Cancel
        </Button>
      );
    }
    if (status === 'not-installed') {
      return (
        <Button variant="outline" size="sm" onClick={handleInstall}>
          Install / Setup
        </Button>
      );
    }
    if (status === 'not-connected') {
      return (
        <Button size="sm" onClick={handleConnect} disabled={busy !== null} data-testid={`connect-${entry.providerId}`}>
          {busy === 'connect' ? 'Connecting…' : 'Connect'}
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
            {busy === 'test' ? 'Testing…' : 'Test Connection'}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </>
      );
    }
    // permission-limited | expired | error → reconnect + test + disconnect
    return (
      <>
        <Button size="sm" onClick={handleConnect} disabled={busy !== null}>
          {busy === 'connect' ? 'Connecting…' : 'Reconnect'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={busy !== null}
          data-testid={`test-${entry.providerId}`}
        >
          {busy === 'test' ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={busy !== null}>
          Disconnect
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
              {KIND_LABEL[entry.kind]}
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
          {portfolioReady && <span className="text-[var(--mac-green)]">Portfolio ✓</span>}
          {lastCheck != null && (
            <span className="tabular-nums">{new Date(lastCheck).toLocaleString()}</span>
          )}
        </div>
      )}

      {waiting && (
        <div className="mt-3 rounded-[10px] border border-[var(--mac-yellow)]/30 bg-[var(--mac-yellow)]/10 p-3">
          <div className="text-[12px] font-medium text-foreground">Waiting for authorization…</div>
          {verificationUrl && (
            <ExternalLink url={verificationUrl} label="Open verification page" clientHasOpenExternal={hasOpenExternal(client)} onOpen={() => void openExternalUrl(client, verificationUrl)} />
          )}
          <div className="mt-1.5 text-[11px] text-foreground/48">
            Authorize in your browser, then return here — this page will update automatically.
          </div>
        </div>
      )}

      {byok && showApiKey && (
        <div className="mt-3 space-y-2 rounded-[10px] border mac-section-divider p-3">
          <div className="text-[12px] font-medium text-foreground">Enter your API key</div>
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key"
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void handleSaveKey()} disabled={busy !== null}>
              {busy === 'setConfig' ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowApiKey(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
          {byok && (
            <div className="text-[10px] leading-relaxed text-foreground/42">
              Your own key governs usage. Free tiers may return end-of-day data (5 calls/min) and
              require attribution (&quot;Powered by Polygon.io&quot;).
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
            aria-label="Dismiss error"
          >
            Dismiss
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

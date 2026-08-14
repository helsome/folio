import React, { useCallback, useEffect, useState } from 'react';
import { useFinagentClient } from '../../client';
import {
  collectDiagnosticsSnapshot,
  exportDiagnosticsBundle,
  type DiagnosticsBundle,
  type DiagnosticsErrorEntry,
  type DiagnosticsFinancialProvider,
} from '../../client/diagnostics';
import { Button } from '../primitives/Button';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 border-b mac-section-divider py-1.5">
    <span className="text-[12px] text-foreground/52">{label}</span>
    <span className="text-right font-mono text-[12px] text-foreground">{value}</span>
  </div>
);

function fmtTime(at: number): string {
  return new Date(at).toISOString();
}

export const DiagnosticsTab: React.FC = () => {
  const client = useFinagentClient();
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const snapshot = await collectDiagnosticsSnapshot(client);
    if (snapshot) {
      setBundle(snapshot);
    } else {
      setBundle(null);
      setError('Diagnostics are not available yet — the diagnostics channel is not wired.');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportDiagnosticsBundle(client);
    } finally {
      setExporting(false);
    }
  }, [client]);

  const onCopySummary = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(buildSummary(bundle));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [bundle]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-foreground/72">
          App health snapshot for troubleshooting and support.
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onCopySummary()}>
            {copied ? 'Copied' : 'Copy summary'}
          </Button>
          <Button variant="default" size="sm" disabled={exporting} onClick={() => void onExport()}>
            {exporting ? 'Exporting…' : 'Export Diagnostics'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-4 py-3 text-[12px] text-foreground/78">
          {error}
        </div>
      )}

      {bundle && (
        <>
          <Section title="Application">
            <Row label="Version" value={bundle.app.version} />
            <Row label="Platform" value={`${bundle.app.platform.os} / ${bundle.app.platform.arch}`} />
            <Row label="Electron" value={bundle.app.platform.electron ?? '—'} />
            <Row label="Collected" value={fmtTime(new Date(bundle.collectedAt).getTime())} />
          </Section>

          <Section title="Agent runtime">
            <Row label="Provider" value={bundle.runtime.agent.providerId ?? '—'} />
            <Row label="State" value={bundle.runtime.agent.state ?? '—'} />
          </Section>

          <Section title="Providers">
            <Row label="LLM provider" value={bundle.providers.llm.id ?? '—'} />
            <Row label="LLM model" value={bundle.providers.llm.model ?? '—'} />
            <Row label="Broker connected" value={bundle.providers.broker.connected ? 'Yes' : 'No'} />
            <Row label="Broker accounts" value={String(bundle.providers.broker.accountCount)} />
            <Row label="Longbridge CLI" value={bundle.providers.longbridgeCliVersion ?? '—'} />
          </Section>

          <Section title="Financial providers">
            {bundle.providers.financial.length === 0 ? (
              <div className="text-[12px] text-foreground/44">None connected.</div>
            ) : (
              bundle.providers.financial.map((provider) => (
                <FinancialProviderRow key={provider.id} provider={provider} />
              ))
            )}
          </Section>

          <Section title="Skills & capabilities">
            <Row label="Skills loaded" value={String(bundle.skills.loaded)} />
            <Row label="Capabilities available" value={String(bundle.capabilities.available.length)} />
            <div className="flex flex-wrap gap-1 pt-1">
              {bundle.capabilities.available.map((id) => (
                <span
                  key={id}
                  className="rounded-[6px] bg-[var(--mac-sidebar-hover)] px-2 py-0.5 font-mono text-[11px] text-foreground/72"
                >
                  {id}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Resources">
            <Row label="Mode" value={bundle.resources.dev ? 'Development' : 'Packaged'} />
            <Row label="Runtime root" value={bundle.resources.root} />
          </Section>

          <Section title="Last errors">
            {bundle.errors.length === 0 ? (
              <div className="text-[12px] text-foreground/44">No recent errors.</div>
            ) : (
              <ul className="space-y-2">
                {bundle.errors.map((entry) => (
                  <ErrorRow key={`${entry.at}-${entry.message}`} entry={entry} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

const FinancialProviderRow: React.FC<{ provider: DiagnosticsFinancialProvider }> = ({
  provider,
}) => (
  <div className="rounded-[10px] border mac-section-divider p-3">
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] font-semibold text-foreground">{provider.id}</span>
      <span className="font-mono text-[12px] text-foreground/72">{provider.status}</span>
    </div>
    <div className="mt-1 text-[11px] text-foreground/52">
      Markets: {provider.coverage.markets.join(', ') || '—'}
    </div>
    <div className="text-[11px] text-foreground/52">
      Capabilities: {provider.coverage.capabilities.join(', ') || '—'}
    </div>
  </div>
);

const ErrorRow: React.FC<{ entry: DiagnosticsErrorEntry }> = ({ entry }) => (
  <li className="rounded-[10px] border mac-section-divider p-3">
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-[12px] text-foreground">{entry.source ?? 'unknown'}</span>
      <span className="font-mono text-[11px] text-foreground/44">{fmtTime(entry.at)}</span>
    </div>
    <div className="mt-1 text-[12px] text-foreground/78">{entry.message}</div>
    {entry.stack && (
      <pre className="mt-2 max-h-32 overflow-auto rounded-[6px] bg-[var(--mac-sidebar-hover)] p-2 font-mono text-[10px] text-foreground/60">
        {entry.stack}
      </pre>
    )}
  </li>
);

/** Human-readable one-line-ish summary used by the copy button. */
function buildSummary(bundle: DiagnosticsBundle): string {
  const lines = [
    `Folio ${bundle.app.version} (${bundle.app.platform.os}/${bundle.app.platform.arch})`,
    `Agent runtime: ${bundle.runtime.agent.providerId ?? '—'} (${bundle.runtime.agent.state ?? '—'})`,
    `LLM: ${bundle.providers.llm.id ?? '—'} / ${bundle.providers.llm.model ?? '—'}`,
    `Broker: ${bundle.providers.broker.connected ? 'connected' : 'disconnected'} (${bundle.providers.broker.accountCount} account(s))`,
    `Longbridge CLI: ${bundle.providers.longbridgeCliVersion ?? '—'}`,
    `Skills loaded: ${bundle.skills.loaded}, capabilities: ${bundle.capabilities.available.length}`,
    `Resources: ${bundle.resources.dev ? 'dev' : 'packaged'} @ ${bundle.resources.root}`,
    `Recent errors: ${bundle.errors.length}`,
  ];
  return lines.join('\n');
}

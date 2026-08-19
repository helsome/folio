import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restarting, setRestarting] = useState(false);


  const refresh = useCallback(async () => {
    setError(null);
    const snapshot = await collectDiagnosticsSnapshot(client);
    if (snapshot) {
      setBundle(snapshot);
    } else {
      setBundle(null);
      setError(t('diagnostics.notAvailable'));
    }
  }, [client, t]);

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

  const onRestartRuntime = useCallback(async () => {
    setRestarting(true);
    try {
      await client.diagnostics?.restartRuntime?.();
      await refresh();
    } finally {
      setRestarting(false);
    }
  }, [client, refresh]);

  const onCopySummary = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(buildSummary(bundle, t));
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
          {t('diagnostics.subtitle')}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            {t('diagnostics.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onCopySummary()}>
            {copied ? t('diagnostics.copied') : t('diagnostics.copySummary')}
          </Button>
          <Button variant="default" size="sm" disabled={exporting} onClick={() => void onExport()}>
            {exporting ? t('diagnostics.exporting') : t('diagnostics.exportDiagnostics')}
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
          <Section title={t('diagnostics.sectionApplication')}>
            <Row label={t('diagnostics.version')} value={bundle.app.version} />
            <Row label={t('diagnostics.platform')} value={`${bundle.app.platform.os} / ${bundle.app.platform.arch}`} />
            <Row label={t('diagnostics.electron')} value={bundle.app.platform.electron ?? '—'} />
            <Row label={t('diagnostics.collected')} value={fmtTime(new Date(bundle.collectedAt).getTime())} />
          </Section>

          <Section title={t('diagnostics.sectionAgentRuntime')}>
            <Row label={t('diagnostics.provider')} value={bundle.runtime.agent.providerId ?? '—'} />
            <Row label={t('diagnostics.state')} value={bundle.runtime.agent.state ?? '—'} />
          </Section>

          <Section title={t('diagnostics.sectionProviders')}>
            <Row label={t('diagnostics.llmProvider')} value={bundle.providers.llm.id ?? '—'} />
            <Row label={t('diagnostics.llmModel')} value={bundle.providers.llm.model ?? '—'} />
            <Row label={t('diagnostics.brokerConnected')} value={bundle.providers.broker.connected ? t('diagnostics.yes') : t('diagnostics.no')} />
            <Row label={t('diagnostics.brokerAccounts')} value={String(bundle.providers.broker.accountCount)} />
            <Row label={t('diagnostics.longbridgeCli')} value={bundle.providers.longbridgeCliVersion ?? '—'} />
          </Section>

          <Section title={t('diagnostics.sectionFinancialProviders')}>
            {bundle.providers.financial.length === 0 ? (
              <div className="text-[12px] text-foreground/44">{t('diagnostics.noneConnected')}</div>
            ) : (
              bundle.providers.financial.map((provider) => (
                <FinancialProviderRow key={provider.id} provider={provider} t={t} />
              ))
            )}
          </Section>

          <Section title={t('diagnostics.sectionSkillsCapabilities')}>
            <Row label={t('diagnostics.skillsLoaded')} value={String(bundle.skills.loaded)} />
            <Row label={t('diagnostics.capabilitiesAvailable')} value={String(bundle.capabilities.available.length)} />
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

          <Section title={t('diagnostics.sectionResources')}>
            <Row label={t('diagnostics.mode')} value={bundle.resources.dev ? t('diagnostics.development') : t('diagnostics.packaged')} />
            <Row label={t('diagnostics.runtimeRoot')} value={bundle.resources.root} />
          </Section>

          <Section title={t('diagnostics.sectionPiRuntime')}>
            <Row label={t('diagnostics.piStatus')} value={bundle.pi.status ?? '—'} />
            <Row label={t('diagnostics.piCommand')} value={bundle.pi.command ?? '—'} />
            <Row label={t('diagnostics.piProvider')} value={bundle.pi.providersConfigured.join(', ') || '—'} />
            <Row label={t('diagnostics.piModel')} value={bundle.pi.model ?? '—'} />
            <Row label={t('diagnostics.piExtensions')} value={bundle.pi.extensions.join(', ') || '—'} />
            <Row label={t('diagnostics.piLastExit')} value={`${bundle.pi.lastExitCode ?? '—'} ${bundle.pi.lastExitSignal ?? ''}`.trim()} />
            <Row label={t('diagnostics.piDegraded')} value={bundle.pi.observabilityDegraded == null ? '—' : bundle.pi.observabilityDegraded ? t('diagnostics.yes') : t('diagnostics.no')} />
            {bundle.pi.stderrTail && (
              <pre className="mt-1 max-h-28 overflow-auto rounded-[8px] bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/60">
                {bundle.pi.stderrTail}
              </pre>
            )}
            <div className="pt-1">
              <Button variant="outline" size="sm" onClick={() => void onRestartRuntime()} disabled={restarting}>
                {restarting ? t('diagnostics.restarting') : t('diagnostics.restartRuntime')}
              </Button>
            </div>
          </Section>

          <Section title={t('diagnostics.sectionLastErrors')}>
            {bundle.errors.length === 0 ? (
              <div className="text-[12px] text-foreground/44">{t('diagnostics.noRecentErrors')}</div>
            ) : (
              <ul className="space-y-2">
                {bundle.errors.map((entry) => (
                  <ErrorRow key={`${entry.at}-${entry.message}`} entry={entry} t={t} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

const FinancialProviderRow: React.FC<{
  provider: DiagnosticsFinancialProvider;
  t: (key: string) => string;
}> = ({ provider, t }) => (
  <div className="rounded-[10px] border mac-section-divider p-3">
    <div className="flex items-baseline justify-between">
      <span className="text-[13px] font-semibold text-foreground">{provider.id}</span>
      <span className="font-mono text-[12px] text-foreground/72">{provider.status}</span>
    </div>
    <div className="mt-1 text-[11px] text-foreground/52">
      {t('diagnostics.markets')}: {provider.coverage.markets.join(', ') || '—'}
    </div>
    <div className="text-[11px] text-foreground/52">
      {t('diagnostics.capabilities')}: {provider.coverage.capabilities.join(', ') || '—'}
    </div>
  </div>
);

const ErrorRow: React.FC<{ entry: DiagnosticsErrorEntry; t: (key: string) => string }> = ({
  entry,
  t,
}) => (
  <li className="rounded-[10px] border mac-section-divider p-3">
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-[12px] text-foreground">{entry.source ?? t('diagnostics.unknown')}</span>
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
function buildSummary(bundle: DiagnosticsBundle, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const lines = [
    t('diagnostics.summaryFolio', {
      version: bundle.app.version,
      os: bundle.app.platform.os,
      arch: bundle.app.platform.arch,
    }),
    t('diagnostics.summaryAgentRuntime', {
      provider: bundle.runtime.agent.providerId ?? '—',
      state: bundle.runtime.agent.state ?? '—',
    }),
    t('diagnostics.summaryLlm', {
      provider: bundle.providers.llm.id ?? '—',
      model: bundle.providers.llm.model ?? '—',
    }),
    t('diagnostics.summaryBroker', {
      status: bundle.providers.broker.connected
        ? t('diagnostics.brokerConnectedStatus')
        : t('diagnostics.brokerDisconnectedStatus'),
      count: bundle.providers.broker.accountCount,
    }),
    t('diagnostics.summaryLongbridgeCli', { version: bundle.providers.longbridgeCliVersion ?? '—' }),
    t('diagnostics.summarySkills', {
      loaded: bundle.skills.loaded,
      capabilities: bundle.capabilities.available.length,
    }),
    t('diagnostics.summaryResources', {
      mode: bundle.resources.dev ? t('diagnostics.resourceModeDev') : t('diagnostics.resourceModePackaged'),
      root: bundle.resources.root,
    }),
    t('diagnostics.summaryRecentErrors', { count: bundle.errors.length }),
  ];
  return lines.join('\n');
}

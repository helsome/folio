import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderCoverage } from '@finagent/core';
import { useFinagentClient } from '../../client';
import {
  CAPABILITY_FAMILIES,
  familyCovered,
  loadConnections,
  loadCoverage,
  subscribeConnections,
  type ConnectionEntry,
} from '../../client/connections';
import { ConnectionCard } from './ConnectionCard';

/**
 * Connections tab (spec §11, §14): provider cards + capability matrix.
 * The Lead wires `connections:*`; until then the list degrades to an empty
 * state and each action reports a visible error (never silent).
 */
export const ConnectionsCenter: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [entries, setEntries] = useState<ConnectionEntry[]>([]);
  const [coverage, setCoverage] = useState<ProviderCoverage[]>([]);
  const [loading, setLoading] = useState(true);

  const channelAvailable = typeof client.connections?.list === 'function';

  const refresh = useCallback(async () => {
    const [conns, cov] = await Promise.all([loadConnections(client), loadCoverage(client)]);
    setEntries(conns);
    setCoverage(cov);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeConnections(client, (changed) => {
      setEntries(changed);
      setLoading(false);
    });
    return unsubscribe;
  }, [client]);

  const nameFor = (providerId: string): string =>
    entries.find((entry) => entry.providerId === providerId)?.name ?? providerId;

  return (
    <div className="max-w-4xl space-y-7" data-testid="connections-center">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">{t('connections.title')}</h2>
          {!loading && (
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] text-foreground/52">{t('connections.providerCount', { count: entries.length })}</span>
          )}
        </div>

        {!channelAvailable && (
          <div className="rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-[12px] text-foreground/72">
            {t('connections.notWired')}
          </div>
        )}

        {loading && channelAvailable ? (
          <div className="text-[12px] text-foreground/48">{t('connections.loading')}</div>
        ) : entries.length === 0 && channelAvailable ? (
          <div className="rounded-xl border border-border bg-surface p-5 text-[12px] text-foreground/48 shadow-sm">
            {t('connections.noneConfigured')}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {entries.map((entry) => (
              <ConnectionCard key={entry.providerId} entry={entry} onChanged={() => void refresh()} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">{t('connections.capabilityMatrix')}</h2>
        {coverage.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-5 text-[12px] text-foreground/48 shadow-sm">
            {t('connections.noCoverage')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" data-testid="capability-matrix">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60">
                  <th className="px-4 py-3 pr-3 text-left font-medium text-foreground/54">{t('connections.provider')}</th>
                  {CAPABILITY_FAMILIES.map((family) => (
                    <th key={family} className="px-3 py-3 text-center font-medium text-foreground/54">
                      {family}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.map((entry) => (
                  <tr key={entry.providerId} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 pr-3 text-foreground">{nameFor(entry.providerId)}</td>
                    {CAPABILITY_FAMILIES.map((family) => (
                      <td key={family} className="px-3 py-2 text-center tabular-nums">
                        {familyCovered(entry, family) ? (
                        <span className="text-success">✓</span>
                        ) : (
                          <span className="text-foreground/30">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
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
    <div className="max-w-3xl space-y-6" data-testid="connections-center">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">Connections</h2>
          {!loading && (
            <span className="text-[11px] text-foreground/42">{entries.length} provider(s)</span>
          )}
        </div>

        {!channelAvailable && (
          <div className="rounded-[10px] border border-[var(--mac-yellow)]/30 bg-[var(--mac-yellow)]/10 px-3 py-2 text-[12px] text-foreground/72">
            Provider connections aren&apos;t wired into this build yet — this list will populate
            once the Connections IPC lands.
          </div>
        )}

        {loading && channelAvailable ? (
          <div className="text-[12px] text-foreground/48">Loading connections…</div>
        ) : entries.length === 0 && channelAvailable ? (
          <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
            No providers configured yet.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <ConnectionCard key={entry.providerId} entry={entry} onChanged={() => void refresh()} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">Capability matrix</h2>
        {coverage.length === 0 ? (
          <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
            Coverage data will appear once providers are registered.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" data-testid="capability-matrix">
              <thead>
                <tr className="border-b mac-section-divider">
                  <th className="py-2 pr-3 text-left font-medium text-foreground/54">Provider</th>
                  {CAPABILITY_FAMILIES.map((family) => (
                    <th key={family} className="px-3 py-2 text-center font-medium text-foreground/54">
                      {family}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.map((entry) => (
                  <tr key={entry.providerId} className="border-b mac-section-divider">
                    <td className="py-2 pr-3 text-foreground">{nameFor(entry.providerId)}</td>
                    {CAPABILITY_FAMILIES.map((family) => (
                      <td key={family} className="px-3 py-2 text-center tabular-nums">
                        {familyCovered(entry, family) ? (
                          <span className="text-[var(--mac-green)]">✓</span>
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
        )}
      </section>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import type { LongBridgeStatus, MarketStatus } from '@finagent/core';
import { useFinagentClient } from '../../client';

/** LongBridge CLI status card plus per-market session status table. */
export const LongbridgeTab: React.FC = () => {
  const client = useFinagentClient();
  const [status, setStatus] = useState<LongBridgeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [markets, setMarkets] = useState<MarketStatus[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoadingStatus(true);
    client.longbridge.getStatus().then((result) => {
      if (!mounted) return;
      setLoadingStatus(false);
      if (result.ok) {
        setStatus(result.data);
        setStatusError(null);
      } else {
        setStatus(null);
        setStatusError(result.error.message);
      }
    });
    return () => {
      mounted = false;
    };
  }, [client]);

  useEffect(() => {
    let mounted = true;
    setLoadingMarkets(true);
    client.market.getMarketStatus().then((result) => {
      if (!mounted) return;
      setLoadingMarkets(false);
      if (result.ok) {
        setMarkets(result.data);
        setMarketsError(null);
      } else {
        setMarkets([]);
        setMarketsError(result.error.message);
      }
    });
    return () => {
      mounted = false;
    };
  }, [client]);

  const available = status?.available === true;
  const installed = status?.installed === true;

  return (
    <div className="max-w-2xl space-y-5">
      <section>
        <h2 className="mb-3 text-[14px] font-semibold text-foreground">LongBridge status</h2>
        {loadingStatus ? (
          <div className="text-[13px] text-foreground/48">Loading status…</div>
        ) : statusError ? (
          <div className="text-[13px] text-destructive">{statusError}</div>
        ) : (
          <div className="mac-stock-tile rounded-[14px] p-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-foreground">LongBridge CLI</div>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  available
                    ? 'border-[var(--mac-green)]/30 bg-[var(--mac-green)]/10 text-[var(--mac-green)]'
                    : installed
                      ? 'border-[var(--mac-yellow)]/30 bg-[var(--mac-yellow)]/10 text-[var(--mac-yellow)]'
                      : 'border-[var(--mac-red)]/30 bg-[var(--mac-red)]/10 text-[var(--mac-red)]'
                }`}
              >
                {available ? 'Available' : installed ? 'Setup needed' : 'Not installed'}
              </span>
            </div>
            <dl className="mt-3 space-y-2">
              <Row label="Installed" value={installed ? 'Yes' : 'No'} />
              <Row label="Authenticated" value={status?.authenticated ? 'Yes' : 'No'} />
              <Row label="Message" value={status?.message ?? '—'} />
              {status?.action && <Row label="Next step" value={status.action} />}
            </dl>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[14px] font-semibold text-foreground">Market status</h2>
        {loadingMarkets ? (
          <div className="text-[13px] text-foreground/48">Loading markets…</div>
        ) : marketsError ? (
          <div className="text-[13px] text-destructive">{marketsError}</div>
        ) : markets.length === 0 ? (
          <div className="text-[13px] text-foreground/48">No market status available</div>
        ) : (
          <div className="mac-stock-tile overflow-hidden rounded-[14px]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b mac-section-divider text-left text-[11px] font-semibold uppercase tracking-wider text-foreground/42">
                  <th className="px-4 py-2.5">Market</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.market} className="border-b mac-section-divider last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{market.market}</td>
                    <td className="px-4 py-2.5 text-foreground/72">{market.status}</td>
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

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4">
    <dt className="text-[12px] text-foreground/54">{label}</dt>
    <dd className="text-right text-[12px] font-medium text-foreground">{value}</dd>
  </div>
);

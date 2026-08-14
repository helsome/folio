import React, { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { PortfolioFailureKind } from '@finagent/core';
import {
  portfolioCacheAtom,
  fetchPortfolioAtom,
  selectedAccountIdAtom,
  portfolioViewAtom,
  selectedPositionAtom,
  activeSymbolAtom,
} from '../../atoms';
import { portfolioRiskCacheAtom, analyzePortfolioRiskAtom } from '../../atoms/portfolioRiskAtoms';
import { useFinagentClient } from '../../client';
import { PortfolioCard } from '../portfolio/PortfolioCard';
import { HoldingRow } from '../portfolio/HoldingRow';
import { AssetPieChart } from '../portfolio/AssetPieChart';
import { PortfolioRiskPanel } from '../portfolio/PortfolioRiskPanel';
import { Button } from '../primitives/Button';
import { formatFreshness } from '../../lib/money';

const FAILURE_HEADINGS: Record<PortfolioFailureKind, string> = {
  'not-connected': 'LongBridge not connected',
  'no-account-permission': 'No portfolio access',
  empty: 'No portfolio yet',
  partial: 'Holdings unavailable',
  'provider-error': 'Portfolio unavailable',
  'parse-error': "Couldn't read portfolio data",
  timeout: 'Portfolio timed out',
};

export const PortfolioSection: React.FC = () => {
  const client = useFinagentClient();
  const cache = useAtomValue(portfolioCacheAtom);
  const view = useAtomValue(portfolioViewAtom);
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom);
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountIdAtom);
  const setSelectedPosition = useSetAtom(selectedPositionAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const riskCache = useAtomValue(portfolioRiskCacheAtom);
  const analyzeRisk = useSetAtom(analyzePortfolioRiskAtom);

  useEffect(() => {
    fetchPortfolio(client).catch(() => {
      /* error surfaced via portfolioCacheAtom.failure */
    });
  }, [client, fetchPortfolio]);

  // The risk analysis is a top-level action: it renders even when the
  // portfolio fetch is loading, failed, or empty.
  const riskSection = (
    <div className="border-t border-[var(--mac-border)] pt-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void analyzeRisk().catch(() => {})}
        disabled={riskCache.loading}
      >
        {riskCache.loading ? 'Analyzing…' : 'Analyze Portfolio'}
      </Button>

      {riskCache.loading && (
        <div className="mt-3 h-24 animate-pulse rounded-[12px] bg-foreground/6" />
      )}
      {riskCache.error && (
        <div className="mt-3 text-[12px] text-foreground/54">
          Risk analysis failed: {riskCache.error}
        </div>
      )}
      {riskCache.report && <PortfolioRiskPanel report={riskCache.report} />}
    </div>
  );

  if (cache.loading && !view) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-24 animate-pulse rounded-[12px] bg-foreground/6" />
        <div className="h-32 animate-pulse rounded-[12px] bg-foreground/6" />
        {riskSection}
      </div>
    );
  }

  if (!view && cache.failure) {
    return (
      <div className="space-y-3 p-4">
        <div className="mac-stock-tile rounded-[12px] p-4">
          <div className="text-[13px] font-semibold text-foreground">
            {FAILURE_HEADINGS[cache.failure.kind]}
          </div>
          <div className="mt-1 text-[12px] text-foreground/54">{cache.failure.message}</div>
        </div>
        {riskSection}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-[13px] text-foreground/44">No portfolio data.</div>
        {riskSection}
      </div>
    );
  }

  const handleSelect = (symbol: string) => {
    setSelectedPosition(symbol);
    setActiveSymbol(symbol);
  };

  const isPartial = cache.failure?.kind === 'partial';

  return (
    <div className="space-y-3 overflow-y-auto p-4">
      {view.accounts.length > 1 && (
        <label className="flex items-center gap-2 text-[12px] text-foreground/54">
          Account
          <select
            value={selectedAccount ?? ''}
            onChange={(e) => setSelectedAccount(e.target.value === '' ? null : e.target.value)}
            className="rounded-[8px] border border-[var(--mac-border)] bg-background px-2 py-1 text-[12px] text-foreground"
          >
            <option value="">All accounts</option>
            {view.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency ?? '—'})
              </option>
            ))}
          </select>
        </label>
      )}

      {isPartial && (
        <div className="rounded-[10px] bg-[var(--mac-yellow)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {cache.failure?.message}
        </div>
      )}

      <PortfolioCard view={view} />
      <AssetPieChart view={view} />

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          Holdings ({view.holdings.length})
        </h3>
        <div className="space-y-2">
          {view.holdings.map((holding) => (
            <HoldingRow
              key={holding.symbol}
              holding={holding}
              onClick={() => handleSelect(holding.symbol)}
            />
          ))}
          {view.holdings.length === 0 && (
            <div className="py-8 text-center text-[13px] text-foreground/44">
              No holdings in this account.
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-foreground/44">
        {formatFreshness('Longbridge', view.snapshot.fetchedAt)}
      </div>

      {riskSection}
    </div>
  );
};

import React, { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Portfolio } from '@finagent/core';
import {
  portfolioCacheAtom,
  fetchPortfolioAtom,
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

export const PortfolioSection: React.FC = () => {
  const client = useFinagentClient();
  const cache = useAtomValue(portfolioCacheAtom);
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom);
  const setSelectedPosition = useSetAtom(selectedPositionAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const riskCache = useAtomValue(portfolioRiskCacheAtom);
  const analyzeRisk = useSetAtom(analyzePortfolioRiskAtom);

  useEffect(() => {
    fetchPortfolio(client).catch(() => {
      /* error surfaced via portfolioCacheAtom.error */
    });
  }, [client, fetchPortfolio]);

  const portfolio: Portfolio | null = cache.data;

  // The risk analysis is a top-level action: it renders even when the
  // portfolio fetch is loading, failed, or empty (the service records the
  // failures honestly instead of hiding the action).
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

  if (cache.loading && !portfolio) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-24 animate-pulse rounded-[12px] bg-foreground/6" />
        <div className="h-32 animate-pulse rounded-[12px] bg-foreground/6" />
        {riskSection}
      </div>
    );
  }

  if (cache.error && !portfolio) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-[12px] text-foreground/54">
          Portfolio unavailable: {cache.error}
        </div>
        {riskSection}
      </div>
    );
  }

  if (!portfolio) {
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

  return (
    <div className="space-y-3 overflow-y-auto p-4">
      <PortfolioCard portfolio={portfolio} />
      <AssetPieChart portfolio={portfolio} />

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          Holdings ({portfolio.positions.length})
        </h3>
        <div className="space-y-2">
          {portfolio.positions.map((position) => (
            <HoldingRow
              key={position.symbol}
              position={position}
              onClick={() => handleSelect(position.symbol)}
            />
          ))}
          {portfolio.positions.length === 0 && (
            <div className="py-8 text-center text-[13px] text-foreground/44">
              No holdings yet.
            </div>
          )}
        </div>
      </div>
      {riskSection}
    </div>
  );
};

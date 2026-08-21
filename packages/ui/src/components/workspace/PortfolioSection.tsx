import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { PortfolioFailureKind } from '@finagent/core';
import {
  portfolioCacheAtom,
  fetchPortfolioAtom,
  selectedAccountIdAtom,
  portfolioViewAtom,
  selectedPositionAtom,
  activeSymbolAtom,
  isManualAccountId,
  manualAccountId,
  navSectionAtom,
} from '../../atoms';
import { manualPortfoliosAtom, refreshManualPortfoliosAtom } from '../../atoms/portfolioImportAtoms';
import { portfolioRiskCacheAtom, analyzePortfolioRiskAtom } from '../../atoms/portfolioRiskAtoms';
import { researchOriginAtom } from '../../atoms/discoverAtoms';
import { useFinagentClient } from '../../client';
import { PortfolioCard } from '../portfolio/PortfolioCard';
import { HoldingRow } from '../portfolio/HoldingRow';
import { AssetPieChart } from '../portfolio/AssetPieChart';
import { PortfolioRiskPanel } from '../portfolio/PortfolioRiskPanel';
import { ImportDialog } from '../portfolio/ImportDialog';
import { Button } from '../primitives/Button';
import { i18nCurrentLocale } from '@finagent/i18n';

const FAILURE_HEADINGS: Record<PortfolioFailureKind, string> = {
  'not-connected': 'portfolio.failure.notConnected',
  'no-account-permission': 'portfolio.failure.noPermission',
  empty: 'portfolio.failure.empty',
  partial: 'portfolio.failure.partial',
  'provider-error': 'portfolio.failure.providerError',
  'parse-error': 'portfolio.failure.parseError',
  timeout: 'portfolio.failure.timeout',
};

/** Locale-aware `Updated hh:mm:ss` freshness line (spec §34). */
function formatFreshness(t: (k: string, o?: Record<string, unknown>) => string, fetchedAt: number | undefined): string {
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return t('portfolio.freshnessUpdatedUnknown');
  }
  const time = new Intl.DateTimeFormat(i18nCurrentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(fetchedAt);
  return t('portfolio.freshnessUpdated', { time });
}

export const PortfolioSection: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const cache = useAtomValue(portfolioCacheAtom);
  const view = useAtomValue(portfolioViewAtom);
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom);
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountIdAtom);
  const setSelectedPosition = useSetAtom(selectedPositionAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const setResearchOrigin = useSetAtom(researchOriginAtom);
  const riskCache = useAtomValue(portfolioRiskCacheAtom);
  const analyzeRisk = useSetAtom(analyzePortfolioRiskAtom);
  const manualState = useAtomValue(manualPortfoliosAtom);
  const refreshManualPortfolios = useSetAtom(refreshManualPortfoliosAtom);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    fetchPortfolio(client).catch(() => {
      /* error surfaced via portfolioCacheAtom.failure */
    });
    refreshManualPortfolios().catch(() => {
      /* error surfaced via manualPortfoliosAtom.error */
    });
  }, [client, fetchPortfolio, refreshManualPortfolios]);

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
        {riskCache.loading ? t('portfolio.analyzing') : t('portfolio.analyzePortfolio')}
      </Button>

      {riskCache.loading && (
        <div className="mt-3 h-24 animate-pulse rounded-[12px] bg-foreground/6" />
      )}
      {riskCache.error && (
        <div className="mt-3 text-[12px] text-foreground/54">
          {t('portfolio.riskAnalysisFailed', { message: riskCache.error })}
        </div>
      )}
      {riskCache.report && <PortfolioRiskPanel report={riskCache.report} />}
    </div>
  );

  if (cache.loading && !view) {
    return (
      <div className="space-y-3 bg-[#f7f8fa] p-4">
        <div className="h-24 animate-pulse rounded-[14px] border border-[var(--mac-border)] bg-white" />
        <div className="h-32 animate-pulse rounded-[14px] border border-[var(--mac-border)] bg-white" />
        {riskSection}
      </div>
    );
  }

  if (!view && cache.failure) {
    return (
      <div className="space-y-3 bg-[#f7f8fa] p-4">
        <div className="rounded-[14px] border border-[var(--mac-border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
          <div className="text-[13px] font-semibold text-foreground">
            {t(FAILURE_HEADINGS[cache.failure.kind])}
          </div>
          <div className="mt-1 text-[12px] text-foreground/54">{cache.failure.message}</div>
        </div>
        {riskSection}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-3 bg-[#f7f8fa] p-4">
        <div className="text-[13px] text-foreground/44">{t('portfolio.noPortfolioData')}</div>
        {riskSection}
      </div>
    );
  }

  const handleSelect = (symbol: string) => {
    setSelectedPosition(symbol);
    setActiveSymbol(symbol);
  };

  // V9: position → research continuity (spec §51). Carries position context so
  // the agent and the research panel already know the symbol.
  const handleResearch = (symbol: string) => {
    setSelectedPosition(symbol);
    setActiveSymbol(symbol);
    setResearchOrigin({ from: 'portfolio', label: symbol });
    setNavSection('research');
  };

  const isPartial = cache.failure?.kind === 'partial';
  const showAccountSelector =
    view.accounts.length > 1 || manualState.portfolios.length > 0;
  const freshnessProvider = isManualAccountId(selectedAccount)
    ? t('portfolio.manualPortfolio')
    : 'Longbridge';

  return (
    <div className="folio-portfolio-view space-y-4 overflow-y-auto bg-[#f7f8fa] p-4" data-testid="portfolio-view">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-foreground">{t('portfolio.title')}</h2>
          <div className="mt-1 text-[11px] text-foreground/44">{freshnessProvider}</div>
        </div>
        <Button variant="default" size="sm" onClick={() => setImportOpen(true)}>
          {t('portfolio.importButton')}
        </Button>
      </div>

      {showAccountSelector && (
        <label className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--mac-border)] bg-white px-3 py-2 text-[12px] text-foreground/54">
          {t('portfolio.account')}
          <select
            value={selectedAccount ?? ''}
            onChange={(e) => setSelectedAccount(e.target.value === '' ? null : e.target.value)}
            className="rounded-[8px] border border-[var(--mac-border)] bg-white px-2 py-1 text-[12px] text-foreground outline-none focus:border-[var(--mac-blue)]"
          >
            <option value="">{t('portfolio.allAccounts')}</option>
            {view.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency ?? '—'})
              </option>
            ))}
            {manualState.portfolios.map((portfolio) => (
              <option key={portfolio.id} value={manualAccountId(portfolio.id)}>
                {portfolio.name} ({t('portfolio.manual')})
              </option>
            ))}
          </select>
        </label>
      )}

      {isPartial && (
        <div className="rounded-[10px] border border-[var(--mac-yellow)]/20 bg-[var(--mac-yellow)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {cache.failure?.message}
        </div>
      )}

      <PortfolioCard view={view} />
      <AssetPieChart view={view} />

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-foreground/48">
          {t('portfolio.holdings')} ({view.holdings.length})
        </h3>
        <div className="space-y-2">
          {view.holdings.map((holding) => (
            <HoldingRow
              key={holding.symbol}
              holding={holding}
              onClick={() => handleSelect(holding.symbol)}
              onResearch={() => handleResearch(holding.symbol)}
            />
          ))}
          {view.holdings.length === 0 && (
            <div className="py-8 text-center text-[13px] text-foreground/44">
              {t('portfolio.noHoldingsInAccount')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--mac-border)]/70 bg-white/60 px-3 py-2 text-[11px] text-foreground/44">
        {freshnessProvider} · {formatFreshness(t, view.snapshot.fetchedAt)}
      </div>

      {riskSection}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void refreshManualPortfolios().catch(() => {})
        }}
      />
    </div>
  );
};

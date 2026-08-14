import { Type } from '@sinclair/typebox';
import type { FinanceCapability, Holding, PortfolioSnapshot } from '@finagent/core';
import { defineCapability } from '../define.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

const SUPPORTED_CURRENCIES: Record<string, true> = { USD: true, HKD: true, CNY: true, SGD: true };

/** Currency-aware money string (spec §17); plain number + code when unknown. */
function formatMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const code = (currency ?? '').trim().toUpperCase();
  if (code !== '' && SUPPORTED_CURRENCIES[code] === true) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value);
  }
  const number = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return code !== '' ? `${number} ${code}` : number;
}

function signedMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMoney(value, currency)}`;
}

export function createPortfolioSummaryCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<Record<string, never>, PortfolioSnapshot> {
  return defineCapability<Record<string, never>, PortfolioSnapshot>({
    id: 'portfolio.summary',
    name: 'Portfolio',
    toolName: 'get_portfolio',
    category: 'portfolio',
    riskLevel: 'read',
    auth: 'account',
    description:
      'Get the current portfolio: total assets, cash balance, and each holding with cost, market value and unrealized P&L. Use this whenever the user asks about their positions, cash, or overall portfolio value.',
    inputSchema: Type.Object({}),
    async execute(_input, ctx) {
      const snapshot = await fetchers.getPortfolio();
      return {
        data: snapshot,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: formatPortfolio(snapshot),
      };
    },
  });
}

function formatPortfolio(snapshot: PortfolioSnapshot) {
  const currency = snapshot.baseCurrency;
  const positionsText = snapshot.holdings.length > 0
    ? snapshot.holdings.map((position) => formatHolding(position)).join('\n')
    : '  No positions';

  return [
    'Portfolio Summary',
    '-----------------',
    `Total Assets: ${formatMoney(snapshot.totalAssets, currency)}`,
    `Market Value: ${formatMoney(snapshot.marketValue, currency)}`,
    `Cash: ${formatMoney(snapshot.cash, currency)}`,
    `Total P&L: ${signedMoney(snapshot.totalPnL, currency)}`,
    `Today P&L: ${signedMoney(snapshot.todayPnL, currency)}`,
    '',
    `Positions (${snapshot.holdings.length})`,
    positionsText,
  ].join('\n');
}

function formatHolding(position: Holding) {
  const pnlStr = `${signedMoney(position.unrealizedPnL, position.currency)}${position.unrealizedPnLPercent !== undefined ? ` (${position.unrealizedPnLPercent.toFixed(2)}%)` : ''}`;
  return [
    `  ${position.symbol} ${position.name}: ${position.quantity ?? '—'} @ ${formatMoney(position.costPrice, position.currency)}`,
    `     Current: ${formatMoney(position.marketPrice, position.currency)} | Value: ${formatMoney(position.marketValue, position.currency)}`,
    `     P&L: ${pnlStr}`,
  ].join('\n');
}

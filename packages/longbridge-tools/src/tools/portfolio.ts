import { executeLongBridge } from '../executor.ts';
import { parsePortfolioResponse } from '../parser.ts';
import type { Holding, PortfolioSnapshot } from '@finagent/core';

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  const output = await executeLongBridge(['portfolio', '--format', 'json']);
  return parsePortfolioResponse(output);
}

export async function getPositions(): Promise<Holding[]> {
  const portfolio = await getPortfolio();
  return portfolio.holdings;
}

export async function getCash(): Promise<number | undefined> {
  const portfolio = await getPortfolio();
  return portfolio.cash;
}

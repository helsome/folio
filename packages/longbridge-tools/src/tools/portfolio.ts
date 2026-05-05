import { executeLongBridge } from '../executor';
import { parsePortfolioResponse } from '../parser';
import type { Portfolio } from '@finagent/core';

export async function getPortfolio(): Promise<Portfolio> {
  const output = await executeLongBridge(['portfolio', '--format', 'json']);
  return parsePortfolioResponse(output);
}

export async function getPositions(): Promise<Portfolio['positions']> {
  const portfolio = await getPortfolio();
  return portfolio.positions;
}

export async function getCash(): Promise<number> {
  const portfolio = await getPortfolio();
  return portfolio.cash;
}
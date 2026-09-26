import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PortfolioRiskReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { PortfolioRiskPanel } from './PortfolioRiskPanel';

let restoreDom: (() => void) | undefined;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => { restoreDom?.(); });

function report(basis: 'portfolio' | 'available-positions'): PortfolioRiskReport {
  return {
    id: 'risk-test', generatedAt: 1, summary: 'Risk summary.',
    allocation: [{ symbol: 'AAA.US', marketValue: 20, weight: basis === 'portfolio' ? 0.2 : 1 }],
    allocationCoverage: { basis, excludedSymbols: ['0700.HK'] },
    concentration: { top1Weight: basis === 'portfolio' ? 0.2 : 1, top5Weight: basis === 'portfolio' ? 0.2 : 1, herfindahl: basis === 'portfolio' ? 0.04 : 1 },
    signals: [], capabilityRuns: [],
  };
}

async function render(value: PortfolioRiskReport) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(withI18n(<PortfolioRiskPanel report={value} />)); });
  return { container, root };
}

describe('PortfolioRiskPanel allocation coverage', () => {
  it('shows the omitted symbol while preserving known portfolio-wide weights', async () => {
    const { container, root } = await render(report('portfolio'));
    const warning = container.querySelector('[role="status"]');
    expect(warning?.textContent).toContain('0700.HK');
    expect(warning?.textContent).toContain('portfolio total');
    expect(container.textContent).toContain('20%');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('hides whole-portfolio concentration metrics for subset-only weights', async () => {
    const { container, root } = await render(report('available-positions'));
    const warning = container.querySelector('[role="status"]');
    expect(warning?.textContent).toContain('available positions only');
    const metrics = container.querySelector('.grid.grid-cols-3')?.textContent ?? '';
    expect(metrics.match(/—/g)).toHaveLength(3);
    expect(metrics).not.toContain('100.0%');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('explains an empty allocation when holdings lack comparable values', async () => {
    const value = report('portfolio');
    value.allocation = [];
    const { container, root } = await render(value);
    expect(container.textContent).toContain('No holdings with a comparable base-currency value.');
    expect((container.querySelector('.grid.grid-cols-3')?.textContent ?? '').match(/—/g)).toHaveLength(3);
    await act(async () => { root.unmount(); });
    container.remove();
  });
});

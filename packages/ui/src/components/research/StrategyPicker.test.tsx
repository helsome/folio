import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { StrategyId } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { DEFAULT_STRATEGY_ID, StrategyPicker } from './StrategyPicker';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const ALL_STRATEGY_IDS: StrategyId[] = [
  'comprehensive',
  'value',
  'growth',
  'technical',
  'earnings',
  'event-driven',
  'risk-review',
  'income',
];

async function render(value: StrategyId = DEFAULT_STRATEGY_ID, onChange: (id: StrategyId) => void = () => {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<StrategyPicker value={value} onChange={onChange} />);
  });
  return { container, root };
}

describe('StrategyPicker', () => {
  it('renders all eight preset cards with comprehensive selected by default', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="strategy-picker"]')).not.toBeNull();
    for (const id of ALL_STRATEGY_IDS) {
      expect(container.querySelector(`[data-testid="strategy-card-${id}"]`)).not.toBeNull();
    }
    const selected = container.querySelector('[aria-pressed="true"]');
    expect(selected?.getAttribute('data-testid')).toBe('strategy-card-comprehensive');
  });

  it('shows name, description and focus chips on each card', async () => {
    const { container } = await render();
    const card = container.querySelector('[data-testid="strategy-card-value"]');
    expect(card?.textContent).toContain('Value');
    expect(card?.textContent).toContain('valuation');
    expect(card?.textContent).toContain('dividends');
  });

  it('reports the clicked preset via onChange', async () => {
    const selections: StrategyId[] = [];
    const { container } = await render(DEFAULT_STRATEGY_ID, (id) => {
      selections.push(id);
    });
    const technical = container.querySelector(
      '[data-testid="strategy-card-technical"]'
    ) as HTMLElement;
    await act(async () => {
      technical.click();
    });
    expect(selections).toEqual(['technical']);
  });

  it('marks the controlled value as selected', async () => {
    const { container } = await render('income');
    const selected = container.querySelector('[aria-pressed="true"]');
    expect(selected?.getAttribute('data-testid')).toBe('strategy-card-income');
  });
});

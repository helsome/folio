import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createSyncI18n } from '@finagent/i18n';
import type { StrategyId } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
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

async function render(
  value: StrategyId = DEFAULT_STRATEGY_ID,
  onChange: (id: StrategyId) => void = () => {},
  locale: 'en-US' | 'zh-CN' = 'en-US'
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const picker = <StrategyPicker value={value} onChange={onChange} />;
  const wrapped =
    locale === 'zh-CN' ? (
      <I18nextProvider i18n={createSyncI18n({ locale: 'zh-CN' })}>{picker}</I18nextProvider>
    ) : (
      <TestI18n>{picker}</TestI18n>
    );
  await act(async () => {
    root.render(wrapped);
  });
  return { container, root };
}

async function flushTimers(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  }
}

function keyRow(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-testid="strategy-card-${id}"]`) as HTMLElement;
}

describe('StrategyPicker', () => {
  it('renders all eight strategies as a vertical list with comprehensive selected by default', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="strategy-picker"]')).not.toBeNull();
    for (const id of ALL_STRATEGY_IDS) {
      expect(keyRow(container, id)).not.toBeNull();
    }
    const selected = container.querySelector('[aria-checked="true"]');
    expect(selected?.getAttribute('data-testid')).toBe('strategy-card-comprehensive');
  });

  it('uses a single-column full-width vertical layout with no horizontal scroll strip', async () => {
    const { container } = await render();
    // No horizontal carousel / overflow-x-auto anywhere in the picker.
    expect(container.innerHTML).not.toContain('overflow-x-auto');
    const radioRoot = container.querySelector('[role="radiogroup"]');
    expect(radioRoot).not.toBeNull();
    const groupClass = radioRoot?.getAttribute('class') ?? '';
    expect(groupClass).toContain('flex-col');
    // Every row is full-width, block-stacked, never shrunk into a horizontal strip.
    for (const id of ALL_STRATEGY_IDS) {
      const cls = keyRow(container, id).getAttribute('class') ?? '';
      expect(cls).toContain('w-full');
    }
  });

  it('shows localized name, description and focus chips on each strategy', async () => {
    const { container } = await render();
    const row = keyRow(container, 'value');
    expect(row?.textContent).toContain('Value');
    expect(row?.textContent).toContain('Valuation');
    expect(row?.textContent).toContain('Dividends');
  });

  it('reports the clicked strategy via onChange', async () => {
    const selections: StrategyId[] = [];
    const { container } = await render(DEFAULT_STRATEGY_ID, (id) => {
      selections.push(id);
    });
    await act(async () => {
      keyRow(container, 'technical').click();
    });
    expect(selections).toEqual(['technical']);
  });

  it('marks the controlled value as the checked radio item', async () => {
    const { container } = await render('income');
    const selected = container.querySelector('[aria-checked="true"]');
    expect(selected?.getAttribute('data-testid')).toBe('strategy-card-income');
  });

  it('supports keyboard arrow selection and reports the change', async () => {
    const selections: StrategyId[] = [];
    const { container } = await render(DEFAULT_STRATEGY_ID, (id) => {
      selections.push(id);
    });
    const comprehensive = keyRow(container, 'comprehensive');
    comprehensive.focus();
    // Arrow down selects the next strategy in the vertical list.
    await act(async () => {
      comprehensive.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      // Roving focus selects on a macrotask timeout.
      await flushTimers();
    });
    expect(selections).toEqual(['value']);
  });

  it('localizes strategy names, descriptions and focus chips for zh-CN', async () => {
    const { container } = await render(DEFAULT_STRATEGY_ID, () => {}, 'zh-CN');
    const comprehensive = keyRow(container, 'comprehensive');
    expect(comprehensive.textContent).toContain('综合');
    expect(comprehensive.textContent).toContain('市场');
    expect(comprehensive.textContent).toContain('公司');
    // Domain id is never shown as focus text.
    expect(comprehensive.textContent).not.toContain('market');
  });

  it('keeps domain strategy ids ASCII in every locale', async () => {
    const { container } = await render(DEFAULT_STRATEGY_ID, () => {}, 'zh-CN');
    for (const id of ALL_STRATEGY_IDS) {
      expect(keyRow(container, id).getAttribute('data-testid')).toBe(`strategy-card-${id}`);
      expect(keyRow(container, id).getAttribute('value')).toBe(id);
    }
  });
});

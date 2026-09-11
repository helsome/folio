import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { makeAnswerBlockTestI18n } from '../../test/answerBlockI18nTest';
import { I18nextProvider } from 'react-i18next';
import { AnswerContent } from './AnswerContent';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const METRIC_GRID = [
  '```folio-block',
  JSON.stringify({
    version: 1,
    type: 'metric_grid',
    title: 'AAPL.US key metrics',
    evidenceIds: ['get_quote-1'],
    metrics: [
      { label: 'Last', value: 123.45, unit: 'price', currency: 'USD', asOf: '2026-01-15T00:00:00.000Z', change: 1.2, changePercent: 0.98 },
      { label: 'Volume', value: 81234, unit: 'count' },
    ],
  }),
  '```',
].join('\n');

const TIME_SERIES = [
  '```folio-block',
  JSON.stringify({
    version: 1,
    type: 'time_series_chart',
    unit: 'price',
    currency: 'USD',
    points: [
      { t: '2026-01-02T00:00:00.000Z', v: 100 },
      { t: '2026-01-03T00:00:00.000Z', v: 101.5 },
      { t: '2026-01-06T00:00:00.000Z', v: 99.8 },
    ],
  }),
  '```',
].join('\n');

async function renderContent(content: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);
  const i18n = makeAnswerBlockTestI18n('en-US');
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <AnswerContent content={content} />
      </I18nextProvider>
    );
  });
  return container;
}

describe('AnswerContent', () => {
  it('renders plain Markdown through the text pipeline', async () => {
    const container = await renderContent('## Outlook\n\n**Positive**.');
    expect(container.querySelector('h2')?.textContent).toBe('Outlook');
    expect(container.querySelector('strong')?.textContent).toBe('Positive');
    expect(container.querySelector('[data-block-type]')).toBeNull();
  });

  it('renders a valid metric_grid block deterministically with evidence hooks', async () => {
    const container = await renderContent(`Quote below.\n\n${METRIC_GRID}\n\nDone.`);
    expect(container.querySelector('[data-block-type="metric_grid"]')).not.toBeNull();
    expect(container.textContent).toContain('AAPL.US key metrics');
    expect(container.textContent).toContain('$123.45');
    expect(container.textContent).toContain('+0.98%');
    const evidence = container.querySelector('[data-evidence-id="get_quote-1"]');
    expect(evidence).not.toBeNull();
  });

  it('renders a time_series_chart block as an SVG with provenance footer', async () => {
    const container = await renderContent(`Trend:\n\n${TIME_SERIES}`);
    const chart = container.querySelector('[data-testid="answer-block-chart"]');
    expect(chart).not.toBeNull();
    expect(chart?.querySelector('path')).not.toBeNull();
    expect(container.querySelector('[data-block-type="time_series_chart"]')).not.toBeNull();
  });

  it('degrades a closed malformed block to text without crashing the message', async () => {
    const content = 'Intro\n\n```folio-block\n{"version":1,"type":"metric_grid","metrics":"oops"}\n```\n\nOutro';
    const container = await renderContent(content);
    expect(container.querySelector('[data-testid="answer-block-invalid"]')).not.toBeNull();
    expect(container.textContent).toContain('Outro');
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows a loading placeholder for an unfinished streaming block', async () => {
    const content = 'Intro\n\n```folio-block\n{"version":1,"type":"met';
    const container = await renderContent(content);
    expect(container.querySelector('[data-testid="answer-block-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="answer-block-invalid"]')).toBeNull();
  });

  it('renders the DemoBadge for blocks sourced from demo data', async () => {
    const demoBlock = [
      '```folio-block',
      JSON.stringify({
        version: 1,
        type: 'metric_grid',
        source: 'demo',
        metrics: [{ label: 'Last', value: 189.43, unit: 'price', currency: 'USD' }],
      }),
      '```',
    ].join('\n');
    const container = await renderContent(`Quote\n\n${demoBlock}`);
    expect(container.querySelector('[data-testid="demo-badge"]')).not.toBeNull();
  });

  it('renders identical markup for the same content (reload rebuild)', async () => {
    const content = `Text\n\n${METRIC_GRID}`;
    const first = (await renderContent(content)).querySelector('[data-block-type="metric_grid"]')?.innerHTML;
    const second = (await renderContent(content)).querySelector('[data-block-type="metric_grid"]')?.innerHTML;
    expect(first).toBe(second);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { Message } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { makeAnswerBlockTestI18n } from '../../test/answerBlockI18nTest';
import { I18nextProvider } from 'react-i18next';
import { AnswerContent } from './AnswerContent';
import { SourceInspector } from './SourceInspector';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const MESSAGE: Message = {
  id: 'm1',
  role: 'assistant',
  content: '',
  timestamp: 0,
  toolCalls: [
    { id: 'get_quote-1', toolName: 'get_quote', args: { symbol: 'aapl.us' }, startedAt: 1, completedAt: 2, status: 'success' },
  ],
  financialEvidence: [{
    schemaVersion: 'financial-evidence/v1',
    normalizationVersion: 'folio-normalization/v1',
    id: 'fe_abc123',
    sessionId: 's',
    runId: 'r',
    toolCallId: 'get_quote-1',
    toolName: 'get_quote',
    kind: 'quote',
    capabilityId: 'market.quote',
    provider: 'longbridge',
    query: {},
    values: [{ metric: 'lastPrice', originalValue: 182.31, normalizedValue: 182.31, currency: 'USD' }],
    retrievedAt: 1700000000000,
    stale: false,
    cacheHit: false,
    resultSnapshot: {},
    resultHash: 'sha256:deadbeef',
    lineage: [{ kind: 'provider', description: 'Retrieved market.quote from longbridge.' }],
  }],
};

const ANSWER = `AAPL last traded at 182.31 USD.⟦cite:get_quote-1⟧ More text.`;
const FABRICATED = `Claim.⟦cite:made-up-id⟧`;

async function renderElement(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  const root = createRoot(container);
  const i18n = makeAnswerBlockTestI18n('en-US');
  await act(async () => {
    root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
  });
  return container;
}

describe('AnswerContent citations', () => {
  it('renders resolved markers as numbered clickable chips', async () => {
    let clicked: string | undefined;
    const container = await renderElement(
      <AnswerContent
        content={ANSWER}
        message={MESSAGE}
        onOpenSource={(sourceId) => {
          clicked = sourceId;
        }}
      />
    );
    const chip = container.querySelector('[data-citation-id="get_quote-1"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-citation-resolved')).toBe('true');
    expect(chip?.textContent).toBe('1');
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clicked).toBe('get_quote-1');
  });

  it('degrades fabricated markers to muted non-clickable chips', async () => {
    const container = await renderElement(<AnswerContent content={FABRICATED} message={MESSAGE} />);
    const chip = container.querySelector('[data-citation-id="made-up-id"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-citation-resolved')).toBeNull();
    expect(chip?.textContent).toBe('?');
  });

  it('renders markers muted while streaming (no message context)', async () => {
    const container = await renderElement(<AnswerContent content={ANSWER} />);
    const chip = container.querySelector('[data-citation-id="get_quote-1"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-citation-resolved')).toBeNull();
  });

  it('numbers a block evidence id and an inline marker in one space', async () => {
    const block = [
      '```folio-block',
      JSON.stringify({
        version: 1,
        type: 'metric_grid',
        evidenceIds: ['get_quote-1'],
        metrics: [{ label: 'Last', value: 182.31, unit: 'price', currency: 'USD' }],
      }),
      '```',
    ].join('\n');
    const content = `Price.⟦cite:get_quote-1⟧\n\n${block}`;
    const container = await renderElement(<AnswerContent content={content} message={MESSAGE} />);
    const chip = container.querySelector('[data-citation-id="get_quote-1"]');
    const evidence = container.querySelector('[data-evidence-id="get_quote-1"]');
    expect(chip?.textContent).toBe('1');
    expect(evidence?.textContent).toBe('[1]');
  });
});

describe('SourceInspector', () => {
  it('lists sources grouped by kind and expands the financial envelope', async () => {
    const container = await renderElement(<SourceInspector message={MESSAGE} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="source-inspector"]')).not.toBeNull();
    const row = container.querySelector('[data-source-id="get_quote-1"]');
    expect(row).not.toBeNull();
    expect(container.textContent).toContain('fe_abc123');
    expect(container.textContent).toContain('Retrieved market.quote from longbridge.');
    expect(container.textContent).toContain('sha256:deadbeef');
  });

  it('explains missing envelopes instead of inventing provenance', async () => {
    const message: Message = {
      ...MESSAGE,
      toolCalls: [{ id: 'get_news-1', toolName: 'get_news', args: {}, startedAt: 1, status: 'success' }],
      financialEvidence: undefined,
    };
    const container = await renderElement(<SourceInspector message={message} onClose={() => {}} />);
    expect(container.textContent).toContain('get_news-1');
    expect(container.querySelector('[data-testid="source-details"]')?.textContent).not.toContain('fe_');
  });
});

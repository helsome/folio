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

const NEWS_MESSAGE: Message = {
  id: 'm2',
  role: 'assistant',
  content: '',
  timestamp: 0,
  toolCalls: [
    {
      id: 'get_news-1',
      toolName: 'get_news',
      args: { symbol: 'aapl.us', limit: 5 },
      startedAt: 1,
      completedAt: 1_700_000_000_000,
      status: 'success',
      result: {
        data: [{
          title: 'Apple unveils new MacBook lineup',
          url: 'https://news.example.com/apple-macbook',
        }],
      },
    },
  ],
};

const ANSWER = `AAPL last traded at 182.31 USD.⟦cite:get_quote-1⟧ More text.`;
const FABRICATED = `Claim.⟦cite:made-up-id⟧`;

async function renderElement(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  // Attach to the document so focus and :focus-based happy-dom behavior work.
  document.body.appendChild(container);
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
    expect(chip?.tagName).toBe('BUTTON');
    expect(chip?.getAttribute('type')).toBe('button');
    expect(chip?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(chip?.getAttribute('aria-label')).toContain('get_quote-1');
    expect((chip as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0);
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

  it('marks the selected source row and exposes snapshot disclosure state', async () => {
    const container = await renderElement(<SourceInspector message={MESSAGE} onClose={() => {}} />);
    const row = container.querySelector('[data-source-id="get_quote-1"]');
    expect(row?.getAttribute('aria-current')).toBe('true');

    const snapshotToggle = container.querySelector(
      '[data-testid="source-snapshot-toggle"]'
    );
    expect(snapshotToggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      (snapshotToggle as HTMLElement).click();
    });
    expect(snapshotToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#source-snapshot')).not.toBeNull();
  });

  it('moves aria-current when the user selects another source row', async () => {
    const message: Message = {
      ...MESSAGE,
      toolCalls: [
        { id: 'get_news-1', toolName: 'get_news', args: {}, startedAt: 1, status: 'success' },
        { id: 'get_filing-1', toolName: 'get_filing_document', args: {}, startedAt: 2, status: 'success' },
      ],
      financialEvidence: undefined,
    };
    const container = await renderElement(<SourceInspector message={message} onClose={() => {}} />);
    const first = container.querySelector('[data-source-id="get_news-1"]');
    const second = container.querySelector('[data-source-id="get_filing-1"]');
    expect(first?.getAttribute('aria-current')).toBe('true');
    expect(second?.getAttribute('aria-current')).toBeNull();

    await act(async () => {
      second?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(second?.getAttribute('aria-current')).toBe('true');
    expect(first?.getAttribute('aria-current')).toBeNull();
  });

  it('renders non-financial provenance with title, link, and tool arguments', async () => {
    const container = await renderElement(<SourceInspector message={NEWS_MESSAGE} onClose={() => {}} />);
    const details = container.querySelector('[data-testid="source-details"]');
    expect(details?.textContent).toContain('Apple unveils new MacBook lineup');
    expect(details?.textContent).toContain('get_news');
    expect(details?.textContent).toContain('aapl.us');

    const link = container.querySelector('[data-testid="source-link"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://news.example.com/apple-macbook');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
  });

  it('surfaces delayed and reconciled financial provenance', async () => {
    const message: Message = {
      ...MESSAGE,
      financialEvidence: [{
        ...MESSAGE.financialEvidence![0],
        delayed: true,
        reconciliation: { providers: ['longbridge', 'eastmoney'], method: 'priority' },
      }],
    };
    const container = await renderElement(<SourceInspector message={message} onClose={() => {}} />);
    expect(container.textContent).toContain('Delayed data');
    const reconciliation = container.querySelector('[data-testid="source-reconciliation"]');
    expect(reconciliation?.textContent).toContain('longbridge, eastmoney');
    expect(reconciliation?.textContent).toContain('priority');
  });

  it('supports roving arrow-key focus across source rows', async () => {
    const message: Message = {
      ...MESSAGE,
      toolCalls: [
        { id: 'get_news-1', toolName: 'get_news', args: {}, startedAt: 1, status: 'success' },
        { id: 'get_filing-1', toolName: 'get_filing_document', args: {}, startedAt: 2, status: 'success' },
      ],
      financialEvidence: undefined,
    };
    const container = await renderElement(<SourceInspector message={message} onClose={() => {}} />);
    const first = container.querySelector('[data-source-id="get_news-1"]') as HTMLButtonElement;
    const second = container.querySelector('[data-source-id="get_filing-1"]') as HTMLButtonElement;

    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(second.getAttribute('aria-current')).toBe('true');
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    expect(container.ownerDocument.activeElement).toBe(second);

    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(first.getAttribute('aria-current')).toBe('true');
    expect(container.ownerDocument.activeElement).toBe(first);

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(second.getAttribute('aria-current')).toBe('true');
  });
});

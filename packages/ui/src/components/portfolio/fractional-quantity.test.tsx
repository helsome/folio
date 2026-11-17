import { expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18nCurrentLocale, i18nSetCurrentLocale } from '@finagent/i18n';
import { parsePaste } from '../../../../shared/src/portfolio-import/parsers.ts';
import { createDraft, draftToPortfolioInput } from '../../../../shared/src/portfolio-import/draft.ts';
import { withI18n } from '../../test/i18n';
import { HoldingRow } from './HoldingRow';
import { ImportDraftReview } from './ImportDraftReview';

for (const locale of ['en-US', 'zh-CN'] as const) {
  for (const { quantity, expected } of [
    { quantity: 0.25, expected: '0.25' },
    { quantity: 1.5, expected: '1.5' },
    { quantity: 1e-8, expected: '0.00000001' },
    { quantity: 1.5e-20, expected: '0.' + '0'.repeat(19) + '15' },
    { quantity: 1e-21, expected: '1E-21' },
    { quantity: 1_234, expected: '1,234' },
  ]) {
    it('shows accepted ' + quantity + ' shares in review and the confirmed holding in ' + locale, () => {
      const previous = i18nCurrentLocale();
      i18nSetCurrentLocale(locale);
      try {
        const rows = parsePaste('AAPL.US ' + quantity + ' 180.5 USD');
        const draft = createDraft('paste', rows);
        const confirmed = draftToPortfolioInput(draft, 'Fractional portfolio');
        expect(rows[0]).toMatchObject({ quantity, confidence: 1, issues: [] });
        expect(confirmed.holdings[0]?.quantity).toBe(quantity);

        const review = renderToStaticMarkup(withI18n(
          <ImportDraftReview draft={draft} onCancel={() => {}} onConfirm={() => {}} />, locale
        ));
        const body = review.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
        const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
        expect(cells[2]?.[1]).toBe(expected);

        const holding = renderToStaticMarkup(withI18n(<HoldingRow holding={confirmed.holdings[0]} />, locale));
        expect(holding.replace(/<[^>]*>/g, '')).toContain(expected + ' @');
      } finally {
        i18nSetCurrentLocale(previous);
      }
    });
  }
}

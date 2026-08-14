import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResearchDiff, ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { WhatChangedSection } from './WhatChangedSection';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

function renderText(element: React.ReactElement): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container.textContent ?? '';
}

function diff(overrides: Partial<ResearchDiff> = {}): ResearchDiff {
  return {
    id: 'diff-1',
    symbol: 'NVDA.US',
    previousReportId: 'prev-1',
    currentReportId: 'cur-1',
    generatedAt: 1_700_086_400_000,
    changes: [],
    material: false,
    summary: 'test diff',
    ...overrides,
  };
}

describe('WhatChangedSection', () => {
  it('renders the header with the previous report date', () => {
    const previousReport = {
      id: 'prev-1',
      symbol: 'NVDA.US',
      generatedAt: 1_700_000_000_000,
    } as ResearchReport;
    const text = renderText(
      <WhatChangedSection diff={diff()} previousReport={previousReport} />
    );
    expect(text).toMatch(/WHAT CHANGED/i);
    expect(text).toContain('Since');
  });

  it('shows the empty state when nothing changed', () => {
    expect(renderText(<WhatChangedSection diff={diff()} />)).toContain('No material changes');
  });

  it('shows the empty state when only minor changes exist', () => {
    const text = renderText(
      <WhatChangedSection
        diff={diff({
          changes: [
            {
              category: 'growth',
              label: 'Catalyst',
              after: 'New catalyst',
              direction: 'new',
              material: false,
              evidence: [],
            },
          ],
        })}
      />
    );
    expect(text).toContain('No material changes');
  });

  it('renders change rows with category, before → after, direction and material badge', () => {
    const text = renderText(
      <WhatChangedSection
        diff={diff({
          material: true,
          changes: [
            {
              category: 'valuation',
              label: 'Verdict',
              before: 'positive',
              after: 'negative',
              direction: 'worsened',
              material: true,
              evidence: ['capability:company.valuation run:r1'],
            },
            {
              category: 'technical',
              label: 'Price',
              before: 120,
              after: 126,
              direction: 'improved',
              material: true,
              evidence: ['capability:market.quote run:r2'],
            },
          ],
        })}
      />
    );
    expect(text).toContain('Valuation');
    expect(text).toContain('Verdict');
    expect(text).toContain('positive');
    expect(text).toContain('→');
    expect(text).toContain('negative');
    expect(text).toContain('Worsened');
    expect(text).toContain('Improved');
    expect(text).toContain('Material');
    expect(text).not.toContain('No material changes');
  });

  it('renders the thesis impact banner when weakened', () => {
    const text = renderText(
      <WhatChangedSection
        diff={diff({
          material: true,
          thesisImpact: {
            direction: 'weakened',
            summary: 'Material adverse changes (Risk) weaken the thesis.',
          },
          changes: [
            {
              category: 'risk',
              label: 'Risk',
              after: 'Regulatory scrutiny',
              direction: 'new',
              material: true,
              evidence: [],
            },
          ],
        })}
      />
    );
    expect(text).toContain('WEAKENED');
    expect(text).toContain('weaken the thesis');
  });

  it('hides the banner when the impact is unchanged', () => {
    const text = renderText(
      <WhatChangedSection
        diff={diff({ thesisImpact: { direction: 'unchanged', summary: 'No material changes to the thesis.' } })}
      />
    );
    expect(text).not.toContain('UNCHANGED');
    expect(text).toContain('No material changes');
  });
});

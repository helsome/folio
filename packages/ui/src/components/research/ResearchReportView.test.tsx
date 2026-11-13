import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { ResearchDiff, ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { ResearchReportView } from './ResearchReportView';

let restore: () => void;
beforeAll(() => { restore = installHappyDom().restore; });
afterAll(() => restore());
const report: ResearchReport = {
  id: 'a-old', symbol: 'AAPL.US', generatedAt: 1000, summary: 'Old A conclusion', stance: 'neutral', confidence: 0.5,
  sections: [], bullCase: [], bearCase: [], catalysts: [], risks: [], capabilityRuns: [], runStatus: 'completed',
};

it('requests the selected report diff and explicitly explains unavailable comparisons', async () => {
  const calls: unknown[] = [];
  (window as unknown as { electronAPI: unknown }).electronAPI = { research: {
    getDiff: async (input: unknown) => { calls.push(input); return { ok: true, data: undefined }; },
  } };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TestI18n><Provider store={createStore()}><ResearchReportView report={report} /></Provider></TestI18n>));
    expect(calls).toEqual([{ symbol: report.symbol, reportId: report.id }]);
    expect(container.querySelector('[data-testid="what-changed-unavailable"]')?.textContent).toContain('No comparison is available for this report.');
  } finally { await act(async () => root.unmount()); delete (window as unknown as { electronAPI?: unknown }).electronAPI; }
});

it('rejects a diff whose current report identity does not match the rendered version', async () => {
  const wrong: ResearchDiff = { id: 'latest-diff', symbol: report.symbol, currentReportId: 'a-new', previousReportId: report.id, generatedAt: 2000, changes: [], material: false, summary: 'Latest only' };
  (window as unknown as { electronAPI: unknown }).electronAPI = { research: {
    getDiff: async () => ({ ok: true, data: wrong }), getReport: async () => ({ ok: true, data: report }),
  } };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TestI18n><Provider store={createStore()}><ResearchReportView report={report} /></Provider></TestI18n>));
    expect(container.querySelector('[data-testid="what-changed"]') === null).toBe(true);
    expect(container.querySelector('[data-testid="what-changed-unavailable"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); delete (window as unknown as { electronAPI?: unknown }).electronAPI; }
});

it('ignores a delayed diff response after switching to a report without a comparison', async () => {
  let resolve!: (value: unknown) => void;
  const late = new Promise((done) => { resolve = done; });
  const next = { ...report, id: 'b-only', symbol: 'MSFT.US', summary: 'B conclusion' };
  const diff: ResearchDiff = { id: 'old-diff', symbol: report.symbol, currentReportId: report.id,
    previousReportId: 'a-earlier', generatedAt: 1000, material: false, changes: [] };
  (window as unknown as { electronAPI: unknown }).electronAPI = { research: {
    getDiff: ({ symbol }: { symbol: string }) => symbol === report.symbol ? late : Promise.resolve({ ok: true, data: undefined }),
    getReport: async () => ({ ok: true, data: { ...report, id: 'a-earlier' } }),
  } };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (value: ResearchReport) => <TestI18n><ResearchReportView report={value} /></TestI18n>;
  try {
    await act(async () => root.render(render(report)));
    await act(async () => root.render(render(next)));
    await act(async () => resolve({ ok: true, data: diff }));
    expect(container.textContent).toContain(next.summary);
    expect(container.querySelector('[data-testid="what-changed"]') === null).toBe(true);
    expect(container.querySelector('[data-testid="what-changed-unavailable"]') !== null).toBe(true);
  } finally { await act(async () => root.unmount()); delete (window as unknown as { electronAPI?: unknown }).electronAPI; }
});

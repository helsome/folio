import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { RunManifest, RunManifestDiff } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';

let restore: () => void;
let ManifestView: typeof import('./RunInfoPanel')['ManifestView'];
let DiffView: typeof import('./RunInfoPanel')['DiffView'];

beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ ManifestView, DiffView } = await import('./RunInfoPanel'));
});
afterAll(() => restore());

const manifest: RunManifest = {
  schemaVersion: 1,
  runId: 'run-1',
  createdAt: 1000,
  runtimeMode: 'pi',
  provider: 'openai',
  model: 'gpt-4o',
  prompt: { hash: 'abc123', version: 'v1', source: 'skill-index' },
  tools: [{ name: 'get_portfolio', enabled: true }],
  search: { providerId: 'longbridge', configured: true },
  appVersion: '0.4.0',
  locale: 'zh-CN',
};

async function render(node: React.ReactNode): Promise<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
}

it('renders the manifest fields and a secret-free JSON export', async () => {
  const { container, root } = await render(<ManifestView manifest={manifest} />);
  try {
    const text = container.textContent ?? '';
    expect(text).toContain('gpt-4o');
    expect(text).toContain('abc123');
    expect(text).toContain('get_portfolio');
    expect(text).toContain('longbridge');
    expect(container.querySelector('pre')?.textContent).toContain('"runId": "run-1"');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('renders a structured diff with before -> after values and group flags', async () => {
  const diff: RunManifestDiff = {
    changed: true,
    fields: [{ path: 'model', before: 'gpt-4o', after: 'gpt-4o-mini' }],
    groups: { model: true, prompt: false, tools: false, config: false, versions: false },
  };
  const { container, root } = await render(<DiffView diff={diff} />);
  try {
    const text = container.textContent ?? '';
    expect(text).toContain('两次运行配置存在差异');
    expect(text).toContain('model');
    expect(text).toContain('gpt-4o');
    expect(text).toContain('gpt-4o-mini');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('renders an unchanged diff as identical', async () => {
  const diff: RunManifestDiff = {
    changed: false,
    fields: [],
    groups: { model: false, prompt: false, tools: false, config: false, versions: false },
  };
  const { container, root } = await render(<DiffView diff={diff} />);
  try {
    expect(container.textContent ?? '').toContain('两次运行配置一致');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

/**
 * Regression guard for the provider coverage rows.
 *
 * `diagnostics.markets` and `diagnostics.capabilities` both declare an
 * interpolation placeholder (`'Markets: {{list}}'` / `'市场：{{list}}'`), but
 * `FinancialProviderRow` called them without values and appended the list
 * itself after its own `: `. The shipped text was therefore
 * `"Markets: {{list}}: US, HK"` — the raw placeholder was user-visible, and the
 * list landed after a second colon.
 *
 * Two halves had to change together: the call site (pass `{ list }`) and the
 * row's `t` prop, which was narrowed to `(key: string) => string` and so could
 * not accept interpolation options even though the parent passes the real
 * `TFunction`. This test renders the real component against the real resource
 * bundle, so it fails if either half regresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createSyncI18n, type I18nInstance, type SupportedLocale } from '@finagent/i18n';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client';
import type { DiagnosticsBundle } from '../../client/diagnostics';
import { installHappyDom } from '../../test/setupHappyDom';
import { DiagnosticsTab } from './DiagnosticsTab';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/** Minimal but complete bundle; only the financial coverage rows are asserted. */
function bundleWith(markets: string[], capabilities: string[]): DiagnosticsBundle {
  return {
    collectedAt: '2026-08-14T00:00:00.000Z',
    app: {
      version: '0.1.0',
      platform: { os: 'darwin', arch: 'arm64', electron: '33.0.0' },
    },
    runtime: { agent: { providerId: 'local', state: 'idle' } },
    providers: {
      llm: { id: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      financial: [
        { id: 'longbridge', status: 'connected', coverage: { markets, capabilities } },
      ],
      broker: { connected: true, accountCount: 1 },
      longbridgeCliVersion: '0.17.0',
    },
    skills: { loaded: 3 },
    capabilities: { available: ['market.quote'] },
    resources: { dev: true, root: '/repo' },
    pi: {
      status: 'idle',
      command: null,
      cwd: null,
      extensions: [],
      providersConfigured: [],
      model: null,
      lastExitCode: null,
      lastExitSignal: null,
      stderrTail: null,
      observabilityDegraded: null,
    },
    errors: [],
    redaction: { policy: 'standard', applied: true },
  };
}

function clientWith(data: DiagnosticsBundle): FinagentClient {
  return {
    ...fallbackClient,
    diagnostics: {
      collect: async () => ({ ok: true, data }),
      export: async () => ({ ok: true, data: {} }),
      restartRuntime: async () => ({ ok: true, data: undefined }),
    },
  };
}

async function renderTab(data: DiagnosticsBundle, locale: SupportedLocale): Promise<string> {
  const i18n: I18nInstance = createSyncI18n({ locale });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FinagentClientProvider client={clientWith(data)}>
        <I18nextProvider i18n={i18n}>
          <DiagnosticsTab />
        </I18nextProvider>
      </FinagentClientProvider>,
    );
  });
  // `refresh()` resolves asynchronously before the bundle is rendered.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const text = container.textContent ?? '';
  await act(async () => {
    root.unmount();
  });
  container.remove();
  return text;
}

describe('DiagnosticsTab financial provider coverage', () => {
  it('substitutes {{list}} instead of printing the placeholder (en-US)', async () => {
    const text = await renderTab(
      bundleWith(['US', 'HK'], ['market.quote', 'market.kline']),
      'en-US',
    );

    expect(text).toContain('Markets: US, HK');
    expect(text).toContain('Capabilities: market.quote, market.kline');
    expect(text).not.toContain('{{list}}');
    // The list must not be appended after the label's own separator.
    expect(text).not.toContain('Markets: {{list}}:');
  });

  it('keeps the em-dash fallback when a provider reports no coverage', async () => {
    const text = await renderTab(bundleWith([], []), 'en-US');

    expect(text).toContain('Markets: —');
    expect(text).toContain('Capabilities: —');
    expect(text).not.toContain('{{list}}');
  });

  it('substitutes {{list}} through the zh-CN templates as well', async () => {
    const text = await renderTab(bundleWith(['US', 'HK'], ['market.quote']), 'zh-CN');

    expect(text).toContain('市场：US, HK');
    expect(text).toContain('能力：market.quote');
    expect(text).not.toContain('{{list}}');
    expect(text).not.toContain('Markets:');
  });
});

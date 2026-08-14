import { describe, expect, it } from 'bun:test';
import type { ApiResult, ProviderCoverage, ProviderHealth } from '@finagent/core';
import { fallbackClient, type FinagentClient } from '../client';
import {
  connectProvider,
  disconnectProvider,
  familyCovered,
  loadConnections,
  loadCoverage,
  loadHealthCheck,
  quoteAccessSummary,
  setProviderConfig,
  testProvider,
  type ConnectionEntry,
  type HealthCheckReport,
} from './connections';

const ENTRY: ConnectionEntry = {
  providerId: 'longbridge',
  kind: 'broker-account',
  name: 'Longbridge',
  status: 'connected',
  health: {
    status: 'connected',
    lastCheck: 123,
    permissions: [
      { id: 'US', label: 'US', granted: true },
      { id: 'HK', label: 'HK', granted: false },
    ],
  },
  coverage: {
    providerId: 'longbridge',
    capabilities: ['market.quote', 'portfolio.summary'],
    markets: [{ id: 'US', name: 'United States' }],
  },
  configurable: false,
  configured: false,
  hasAccount: true,
  accountLabel: 'US Margin (D123)',
  error: null,
};

const COVERAGE: ProviderCoverage = ENTRY.coverage!;
const HEALTH: ProviderHealth = ENTRY.health!;
const REPORT: HealthCheckReport = {
  ai: { ok: true, detail: 'ready', error: null },
  marketData: { ok: false, detail: null, error: { code: 'AUTH_EXPIRED', message: 'expired' } },
  skills: { ok: true, detail: '12 loaded', error: null },
  agentRuntime: { ok: true, detail: 'running', error: null },
};

function clientWithConnections(
  overrides: Partial<FinagentClient['connections']> = {}
): FinagentClient {
  return {
    ...fallbackClient,
    connections: {
      list: async () => ({ ok: true, data: [ENTRY] }),
      connect: async () => ({ ok: true, data: { status: 'connecting', verificationUrl: 'https://verify' } }),
      cancelConnect: async () => ({ ok: true, data: undefined }),
      disconnect: async () => ({ ok: true, data: null }),
      test: async () => ({ ok: true, data: HEALTH }),
      setConfig: async () => ({ ok: true, data: ENTRY }),
      coverage: async () => ({ ok: true, data: [COVERAGE] }),
      onChanged: () => () => undefined,
      ...overrides,
    },
  };
}

describe('connections client module', () => {
  it('loads entries through unwrapIpcResult', async () => {
    const entries = await loadConnections(clientWithConnections());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.providerId).toBe('longbridge');
    expect(entries[0]?.accountLabel).toBe('US Margin (D123)');
  });

  it('degrades to [] when the channel reports a failure', async () => {
    const client = clientWithConnections({
      list: async () => ({ ok: false, error: { code: 'IPC', message: 'boom' } }),
    });
    expect(await loadConnections(client)).toEqual([]);
  });

  it('degrades to [] when the channel is absent', async () => {
    const client: FinagentClient = { ...fallbackClient, connections: undefined };
    expect(await loadConnections(client)).toEqual([]);
  });

  it('loads coverage through unwrapIpcResult', async () => {
    const coverage = await loadCoverage(clientWithConnections());
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.capabilities).toContain('market.quote');
  });

  it('loads health report through unwrapIpcResult and nulls on absence', async () => {
    const withHealth: FinagentClient = {
      ...fallbackClient,
      health: { check: async () => ({ ok: true, data: REPORT }) },
    };
    expect(await loadHealthCheck(withHealth)).toEqual(REPORT);
    expect(await loadHealthCheck(fallbackClient)).toBeNull();
  });

  it('reports action errors rather than throwing', async () => {
    const client = clientWithConnections({
      connect: async () => ({ ok: false, error: { code: 'CONFIG_UNSUPPORTED', message: 'nope' } }),
    });
    const result = await connectProvider(client, 'longbridge');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFIG_UNSUPPORTED');
  });

  it('reports CHANNEL_UNAVAILABLE when the channel is missing', async () => {
    const client: FinagentClient = { ...fallbackClient, connections: undefined };
    const result = await setProviderConfig(client, 'massive', { apiKey: 'k' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CHANNEL_UNAVAILABLE');
  });

  it('returns successful action data on ok', async () => {
    const connect = await connectProvider(clientWithConnections(), 'longbridge');
    expect(connect.ok).toBe(true);
    expect(connect.data?.verificationUrl).toBe('https://verify');

    const test = await testProvider(clientWithConnections(), 'longbridge');
    expect(test.ok).toBe(true);
    expect(test.data?.status).toBe('connected');

    const disconnect = await disconnectProvider(clientWithConnections(), 'longbridge');
    expect(disconnect.ok).toBe(true);
  });

  it('maps capability families onto coverage entries', () => {
    const coverage = { providerId: 'p', capabilities: ['market.quote'], markets: [] };
    expect(familyCovered(coverage, 'Quote')).toBe(true);
    expect(familyCovered(coverage, 'Portfolio')).toBe(false);
    expect(familyCovered(null, 'Quote')).toBe(false);
  });

  it('summarizes granted quote permissions and never fabricates', () => {
    expect(quoteAccessSummary(undefined)).toBeNull();
    expect(quoteAccessSummary([])).toBeNull();
    expect(quoteAccessSummary([{ id: 'HK', label: 'HK', granted: false }])).toBeNull();
    expect(
      quoteAccessSummary([
        { id: 'US', label: 'US', granted: true },
        { id: 'HK', label: 'HK', granted: false },
      ])
    ).toBe('US ✓');
  });
});

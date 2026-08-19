import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { CapabilityResult, FinanceCapability } from '@finagent/core';
import { createCapabilityRegistry, defineCapability } from '../capabilities/index.ts';
import { collectDiagnostics } from './collector.ts';
import type { DiagnosticsInput } from './types.ts';

function makeCap(id: string): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName: id.replace('.', '_'),
    inputSchema: Type.Object({}),
    async execute(): Promise<CapabilityResult<unknown>> {
      return { data: {}, provenance: { provider: 'test', fetchedAt: 0, stale: false } };
    },
  });
}

function baseInput(): DiagnosticsInput {
  return {
    version: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    electronVersion: '33.0.0',
    agentProviderId: 'local',
    agentState: 'idle',
    llmProviderId: 'anthropic',
    llmModel: 'claude-3-5-sonnet-20241022',
    financialProviders: [
      {
        id: 'longbridge',
        status: 'connected',
        coverage: { capabilities: ['market.quote'], markets: ['US', 'HK'] },
      },
    ],
    brokerConnected: true,
    brokerAccountCount: 2,
    skillsLoadedCount: 18,
    capabilities: createCapabilityRegistry([makeCap('market.quote'), makeCap('market.kline')]),
    resources: { dev: true, root: '/repo' },
    evaluation: {
      backend: 'none',
      tracingEnabled: false,
      privacyLevel: 'standard',
      project: 'folio-agent',
      connected: null,
      traceStatus: 'disabled',
      datasets: ['folio-agent-v1'],
    },
    pi: {
      status: 'running',
      command: 'bunx pi --mode rpc',
      cwd: '/repo',
      extensions: ['.pi/extensions/finagent/index.ts'],
      providersConfigured: ['anthropic'],
      model: 'claude-3-5-sonnet-20241022',
      lastExitCode: null,
      lastExitSignal: null,
      stderrTail: null,
      observabilityDegraded: false,
    },
    errors: [],
  };
}

describe('collectDiagnostics', () => {
  it('assembles a JSON-stable bundle with no undefined fields', async () => {
    const bundle = await collectDiagnostics(baseInput(), {
      fetchLongbridgeVersion: () => Promise.resolve('longbridge 0.17.0\n'),
    });

    // JSON round-trip must not drop or add any field.
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
    expect(bundle.app.version).toBe('0.1.0');
    expect(bundle.app.platform).toEqual({ os: 'darwin', arch: 'arm64', electron: '33.0.0' });
    expect(bundle.providers.longbridgeCliVersion).toBe('0.17.0');
    expect(bundle.capabilities.available).toEqual(['market.quote', 'market.kline']);
    expect(bundle.redaction.applied).toBe(false);
  });

  it('reports longbridge CLI version as null when the probe fails', async () => {
    const bundle = await collectDiagnostics(baseInput(), {
      fetchLongbridgeVersion: () => Promise.reject(new Error('not installed')),
    });
    expect(bundle.providers.longbridgeCliVersion).toBeNull();
  });

  it('reports available capabilities as empty when no registry is supplied', async () => {
    const input = { ...baseInput(), capabilities: null };
    const bundle = await collectDiagnostics(input, {
      fetchLongbridgeVersion: () => Promise.resolve('0.17.0'),
    });
    expect(bundle.capabilities.available).toEqual([]);
  });

  it('copies financial providers and errors without shared references', async () => {
    const input = {
      ...baseInput(),
      errors: [{ at: 1, source: 'main', message: 'boom', stack: 'stack' }],
    };
    const bundle = await collectDiagnostics(input, {
      fetchLongbridgeVersion: () => Promise.resolve('0.17.0'),
    });
    expect(bundle.errors).toEqual(input.errors);
    expect(bundle.providers.financial).toEqual(input.financialProviders);
    // Mutating the source afterwards must not affect the collected bundle.
    input.errors[0].message = 'changed';
    expect(bundle.errors[0].message).toBe('boom');
  });
});

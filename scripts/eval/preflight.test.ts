// Live preflight tests (issue #113): every readiness dimension must surface
// as an explicit failure, and no check may leak a credential value.
import { describe, expect, it } from 'bun:test';
import type { LlmModel, LlmRuntimeState, LlmTestResult } from '@finagent/core';
import type { LlmRuntimeApi } from '../../packages/shared/src/agent/pi-runtime-adapter.ts';
import type { LongBridgeStatus } from '../../packages/longbridge-tools/src/status.ts';
import { formatPreflight, runLivePreflight, type JudgeReadiness } from './preflight.ts';

const MODEL: LlmModel = { provider: 'go', id: 'deepseek-chat', name: 'DeepSeek Chat' };

const STATE: LlmRuntimeState = {
  runtimeProvider: 'pi-runtime',
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  isStreaming: false,
};

function fakeLlm(overrides: Partial<LlmRuntimeApi> = {}): LlmRuntimeApi {
  return {
    getState: async () => STATE,
    listModels: async () => [MODEL],
    setModel: async () => STATE,
    listThinkingLevels: async () => ['off'],
    setThinkingLevel: async () => STATE,
    restart: async () => undefined,
    testProvider: async (): Promise<LlmTestResult> => ({
      ok: true,
      message: 'Connection verified.',
      provider: 'go',
      modelId: 'deepseek-chat',
      latencyMs: 12,
    }),
    ...overrides,
  };
}

function readySource(): Promise<LongBridgeStatus> {
  return Promise.resolve({ installed: true, authed: true, available: true, status: 'available' });
}

const NO_JUDGE: JudgeReadiness = { requested: false, resolved: false, missing: [] };
const GO = { provider: 'go', model: 'deepseek-chat' };

describe('runLivePreflight', () => {
  it('is ready when runtime, model, credentials, and data source all check out', async () => {
    const result = await runLivePreflight({ ...GO, judge: NO_JUDGE, llm: fakeLlm(), dataSource: readySource });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ['model', 'ok'],
      ['pi', 'ok'],
      ['model-available', 'ok'],
      ['credentials', 'ok'],
      ['data-source', 'ok'],
      ['judge', 'skipped'],
    ]);
  });

  it('fails without an explicit model and does not probe with ambient defaults', async () => {
    let probed = false;
    const llm = fakeLlm({
      testProvider: async () => {
        probed = true;
        return { ok: true, message: '', provider: '', modelId: '' };
      },
    });

    const result = await runLivePreflight({ judge: NO_JUDGE, llm, dataSource: readySource });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'model')?.status).toBe('failed');
    expect(result.checks.find((check) => check.id === 'credentials')?.status).toBe('skipped');
    expect(probed).toBe(false);
  });

  it('fails when the Pi runtime does not answer the health check', async () => {
    const llm = fakeLlm({
      getState: async () => {
        throw Object.assign(new Error('Pi health check timed out after 5000ms.'), { code: 'PI_HEALTH_TIMEOUT' });
      },
    });

    const result = await runLivePreflight({ ...GO, judge: NO_JUDGE, llm, dataSource: readySource });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'pi')?.detail).toContain('PI_HEALTH');
    expect(result.checks.find((check) => check.id === 'model-available')?.status).toBe('skipped');
  });

  it('fails when the selected model is not in the runtime catalog', async () => {
    const llm = fakeLlm({ listModels: async () => [{ provider: 'anthropic', id: 'claude-sonnet-4-5' }] });

    const result = await runLivePreflight({ ...GO, judge: NO_JUDGE, llm, dataSource: readySource });

    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.id === 'model-available');
    expect(check?.status).toBe('failed');
    expect(check?.detail).toContain('anthropic');
  });

  it('fails when the credential probe fails, without echoing secrets', async () => {
    const llm = fakeLlm({
      testProvider: async () => ({
        ok: false,
        message: 'No API key found for the selected model (test key sk-live-abcdefgh12345678).',
        provider: 'go',
        modelId: 'deepseek-chat',
      }),
    });

    const result = await runLivePreflight({ ...GO, judge: NO_JUDGE, llm, dataSource: readySource });

    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.id === 'credentials');
    expect(check?.status).toBe('failed');
    expect(check?.detail).not.toContain('sk-live-abcdefgh12345678');
    expect(check?.detail).toContain('[REDACTED]');
  });

  it('fails when the data source is not ready', async () => {
    const result = await runLivePreflight({
      ...GO,
      judge: NO_JUDGE,
      llm: fakeLlm(),
      dataSource: async () => ({
        installed: false,
        authed: false,
        available: false,
        status: 'not_installed',
        error: { code: 'LONGBRIDGE_NOT_INSTALLED', message: 'LongBridge CLI is not installed or not on PATH' },
      }),
    });

    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.id === 'data-source');
    expect(check?.status).toBe('failed');
    expect(check?.detail).toContain('not_installed');
  });

  it('fails a judge that was requested but is missing settings', async () => {
    const result = await runLivePreflight({
      ...GO,
      judge: {
        requested: true,
        resolved: false,
        missing: ['model (--judge-model / FINAGENT_JUDGE_MODEL)'],
      },
      llm: fakeLlm(),
      dataSource: readySource,
    });

    expect(result.ok).toBe(false);
    const check = result.checks.find((entry) => entry.id === 'judge');
    expect(check?.status).toBe('failed');
    expect(check?.detail).toContain('FINAGENT_JUDGE_MODEL');
  });

  it('reports a resolved judge and formats a readable report', async () => {
    const result = await runLivePreflight({
      ...GO,
      judge: { requested: true, resolved: true, provider: 'anthropic', model: 'claude-judge', missing: [] },
      llm: fakeLlm(),
      dataSource: readySource,
    });

    expect(result.ok).toBe(true);
    const report = formatPreflight(result);
    expect(report).toContain('PREFLIGHT: READY');
    expect(report).toContain('anthropic/claude-judge');
  });
});

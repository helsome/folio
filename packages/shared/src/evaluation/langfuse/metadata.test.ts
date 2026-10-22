import { describe, expect, it } from 'bun:test';
import type { RunManifest } from '@finagent/core';
import { langfuseMetadataRecord, langfuseTags, manifestToLangfuseMetadata } from './metadata.ts';

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    createdAt: 1_700_000_000_000,
    runtimeMode: 'pi',
    tools: [],
    ...overrides,
  };
}

describe('manifestToLangfuseMetadata (#21 ↔ #14)', () => {
  it('joins the trace to the manifest run identity and carries its config', () => {
    const meta = manifestToLangfuseMetadata(
      manifest({
        provider: 'openai',
        model: 'gpt-4o',
        appVersion: '0.5.0',
        locale: 'zh-CN',
        strategy: { id: 'copilot-agent', version: '0.5.0' },
        prompt: { hash: 'abc', version: 'prompt-1', source: 'skill-index' },
      }),
      { sessionId: 'sess-1', threadId: 'pi-thread-1' }
    );

    expect(meta).toMatchObject({
      // the manifest runId *is* the folioRunId the exporter uses as trace id
      folioRunId: 'run-1',
      folioSessionId: 'sess-1',
      threadId: 'pi-thread-1',
      runKind: 'normal',
      model: 'gpt-4o',
      provider: 'openai',
      folioVersion: '0.5.0',
      agentVersion: '0.5.0',
      promptVersion: 'prompt-1',
      strategyId: 'copilot-agent',
      locale: 'zh-CN',
    });
    expect(langfuseTags(meta)).toContain('strategy:copilot-agent');
    expect(langfuseTags(meta)).toContain('model:gpt-4o');
  });

  it('derives an evaluation run kind from the manifest gold case / dataset', () => {
    const meta = manifestToLangfuseMetadata(
      manifest({ evaluation: { datasetId: 'folio-agent-v1', caseId: 'case-7', datasetVersion: '1.2.0' } })
    );

    expect(meta.runKind).toBe('evaluation');
    expect(meta.datasetId).toBe('folio-agent-v1');
    expect(meta.goldCaseId).toBe('case-7');
    expect(meta.datasetVersion).toBe('1.2.0');
    const tags = langfuseTags(meta);
    expect(tags).toContain('run_kind:evaluation');
    expect(tags).toContain('gold_case:case-7');
    expect(tags).toContain('dataset:folio-agent-v1@1.2.0');
  });

  it('lets readback-confirmed values win while keeping requested ones separate (#114)', () => {
    const meta = manifestToLangfuseMetadata(manifest({ model: 'manifest-model' }), {
      model: 'readback-model',
      provider: 'readback-provider',
      requestedModel: 'requested-model',
      requestedProvider: 'requested-provider',
    });

    expect(meta.model).toBe('readback-model');
    expect(meta.provider).toBe('readback-provider');
    expect(meta.requestedModel).toBe('requested-model');
    expect(meta.requestedProvider).toBe('requested-provider');
    // requested values must never masquerade as the model that actually ran
    expect(langfuseTags(meta)).toContain('model:readback-model');
    expect(langfuseTags(meta)).not.toContain('model:requested-model');
    expect(langfuseMetadataRecord(meta)).toMatchObject({
      model: 'readback-model',
      requestedModel: 'requested-model',
    });
  });

  it('falls back to the manifest model when no readback value is supplied', () => {
    const meta = manifestToLangfuseMetadata(manifest({ model: 'manifest-model', provider: 'manifest-provider' }));
    expect(meta.model).toBe('manifest-model');
    expect(meta.provider).toBe('manifest-provider');
  });
});

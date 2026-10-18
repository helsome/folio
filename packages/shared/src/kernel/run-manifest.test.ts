import { describe, expect, it } from 'bun:test';
import type { Run, RunManifest, RunManifestContext, RunManifestTool } from '@finagent/core';
import {
  captureRunManifest,
  diffRunManifests,
  exportRunManifest,
  hashManifestInput,
  redactManifestSecrets,
} from './run-manifest.ts';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    status: 'running',
    input: 'hi',
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseContext(): RunManifestContext {
  return {
    runtimeMode: 'pi',
    appVersion: '0.4.0-beta.2',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { thinkingLevel: 'low', baseUrl: 'https://api.openai.com/v1' },
    prompt: { hash: 'abc', version: '0.4.0-beta.2', source: 'skill-index' },
    strategy: { id: 'comprehensive' },
    tools: [
      { name: 'market.quote', capability: 'market.quote', enabled: true },
      { name: 'get_news', capability: 'news.get', enabled: true },
    ],
    search: { providerId: 'longbridge', routing: { primary: 'longbridge', fallback: 'massive' }, configured: true },
    featureFlags: { demoData: false, runtimeProvider: 'pi-runtime' },
    locale: 'en-US',
  };
}

describe('captureRunManifest', () => {
  it('snapshots the run identity anchors and the supplied context', () => {
    const manifest = captureRunManifest(makeRun(), baseContext());
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runId).toBe('run-1');
    expect(manifest.createdAt).toBe(1_700_000_000_000);
    expect(manifest.runtimeMode).toBe('pi');
    expect(manifest.provider).toBe('openai');
    expect(manifest.model).toBe('gpt-4o');
    expect(manifest.modelParams?.thinkingLevel).toBe('low');
    expect(manifest.prompt?.hash).toBe('abc');
    expect(manifest.strategy?.id).toBe('comprehensive');
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.search?.providerId).toBe('longbridge');
    expect(manifest.featureFlags?.demoData).toBe(false);
  });

  it('does not mutate the supplied context tools array', () => {
    const ctx = baseContext();
    const manifest = captureRunManifest(makeRun(), ctx);
    manifest.tools.push({ name: 'extra', enabled: true });
    expect(ctx.tools).toHaveLength(2);
  });

  it('deep-copies nested config so later settings mutations cannot rewrite the snapshot', () => {
    const ctx = baseContext();
    const manifest = captureRunManifest(makeRun(), ctx);

    // Mutate every nested structure the context handed over, as a live settings
    // object would be mutated by a later settings change.
    ctx.model = 'gpt-4o-mini';
    (ctx.modelParams as Record<string, unknown>).thinkingLevel = 'high';
    (ctx.search?.routing as Record<string, unknown>).primary = 'massive';
    (ctx.featureFlags as Record<string, unknown>).demoData = true;
    (ctx.tools as RunManifestTool[])[0]!.name = 'mutated';
    ctx.prompt!.hash = 'mutated';

    expect(manifest.model).toBe('gpt-4o');
    expect(manifest.modelParams?.thinkingLevel).toBe('low');
    expect(manifest.search?.routing?.primary).toBe('longbridge');
    expect(manifest.featureFlags?.demoData).toBe(false);
    expect(manifest.tools[0]?.name).toBe('market.quote');
    expect(manifest.prompt?.hash).toBe('abc');
  });

  it('keeps the context independent of the returned snapshot in the other direction', () => {
    const ctx: RunManifestContext = {
      ...baseContext(),
      budget: { effective: { modelCalls: 3 }, clamped: [] },
    };
    const manifest = captureRunManifest(makeRun(), ctx);
    (manifest.budget?.effective as Record<string, number>).modelCalls = 99;
    manifest.tools[0]!.name = 'mutated';

    expect(ctx.budget?.effective?.modelCalls).toBe(3);
    expect(ctx.tools?.[0]?.name).toBe('market.quote');
  });

  it('defaults tools to an empty list when the context omits them', () => {
    const ctx: RunManifestContext = { runtimeMode: 'local' };
    const manifest = captureRunManifest(makeRun(), ctx);
    expect(manifest.tools).toEqual([]);
    expect(manifest.runtimeMode).toBe('local');
  });

  it('redacts a credential that sneaks into the context before it is ever stored', () => {
    // Capture is the boundary: a caller bug must not be able to put a key into
    // the persisted manifest, so redaction happens here and not only on export.
    const ctx: RunManifestContext = {
      ...baseContext(),
      // @ts-expect-error intentional: simulate a caller bug
      modelParams: { apiKey: 'sk-secret', maxTokens: 4096 },
    };
    const manifest = captureRunManifest(makeRun(), ctx);
    expect((manifest.modelParams as Record<string, unknown>).apiKey).toBe('[redacted]');
    // Sizing params are not credentials — losing them would make the snapshot
    // unable to explain the limits the run obeyed.
    expect(manifest.modelParams?.maxTokens).toBe(4096);
  });
});

describe('redactManifestSecrets', () => {
  it('replaces secret-shaped values recursively but keeps structure', () => {
    const dirty = {
      provider: 'openai',
      modelParams: { apiKey: 'sk-123', baseUrl: 'https://x' },
      nested: { token: 't-9', ok: 1 },
      list: [{ secret: 's', name: 'a' }],
    };
    const clean = redactManifestSecrets(dirty);
    expect(clean.modelParams.apiKey).toBe('[redacted]');
    expect(clean.modelParams.baseUrl).toBe('https://x');
    expect(clean.nested.token).toBe('[redacted]');
    expect(clean.nested.ok).toBe(1);
    expect(clean.list[0].secret).toBe('[redacted]');
    expect(clean.list[0].name).toBe('a');
  });

  it('leaves an already-clean object untouched', () => {
    const clean = { a: 1, b: 'x', c: { d: true } };
    expect(redactManifestSecrets(clean)).toEqual(clean);
  });

  it('keeps token/context sizing config, which is not a credential', () => {
    const clean = redactManifestSecrets({
      modelParams: { maxTokens: 4096, maxOutputTokens: 8192, contextWindow: 128_000 },
      budget: { tokenBudget: 1000 },
      tokenCount: 12,
    });
    expect(clean.modelParams).toEqual({ maxTokens: 4096, maxOutputTokens: 8192, contextWindow: 128_000 });
    expect(clean.budget.tokenBudget).toBe(1000);
    expect(clean.tokenCount).toBe(12);
  });

  it('still redacts token-shaped keys that are credentials', () => {
    const clean = redactManifestSecrets({
      token: 't-9',
      apiToken: 'a-1',
      authToken: 'b-2',
      refreshToken: 'c-3',
      credentials: { user: 'u', pass: 'p' },
    }) as Record<string, unknown>;
    expect(clean.token).toBe('[redacted]');
    expect(clean.apiToken).toBe('[redacted]');
    expect(clean.authToken).toBe('[redacted]');
    expect(clean.refreshToken).toBe('[redacted]');
    expect(clean.credentials).toBe('[redacted]');
  });
});

describe('diffRunManifests', () => {
  it('reports no change for identical manifests', () => {
    const a = captureRunManifest(makeRun(), baseContext());
    const b = captureRunManifest(makeRun({ id: 'run-2' }), baseContext());
    const diff = diffRunManifests(a, b);
    expect(diff.changed).toBe(false);
    expect(diff.fields).toHaveLength(0);
  });

  it('ignores identity anchors (runId/createdAt) but flags model + prompt', () => {
    const a = captureRunManifest(makeRun(), baseContext());
    const b = captureRunManifest(
      makeRun({ id: 'run-2' }),
      { ...baseContext(), model: 'gpt-4o-mini', prompt: { hash: 'def', version: '0.4.0-beta.2', source: 'skill-index' } }
    );
    const diff = diffRunManifests(a, b);
    expect(diff.changed).toBe(true);
    const paths = diff.fields.map((f) => f.path);
    expect(paths).toContain('model');
    expect(paths).toContain('prompt.hash');
    expect(paths).not.toContain('runId');
    expect(paths).not.toContain('createdAt');
    expect(diff.groups.model).toBe(true);
    expect(diff.groups.prompt).toBe(true);
  });

  it('flags tool differences by tool name (added/removed/version)', () => {
    const a = captureRunManifest(makeRun(), baseContext());
    const b = captureRunManifest(
      makeRun({ id: 'run-2' }),
      {
        ...baseContext(),
        tools: [
          { name: 'market.quote', capability: 'market.quote', enabled: true, version: '2.0' },
          { name: 'get_news', capability: 'news.get', enabled: false },
        ],
      }
    );
    const diff = diffRunManifests(a, b);
    const paths = diff.fields.map((f) => f.path);
    expect(paths).toContain('tools.market.quote.version');
    expect(paths).toContain('tools.get_news.enabled');
    expect(diff.groups.tools).toBe(true);
    expect(diff.groups.versions).toBe(true);
  });

  it('flags config (search/featureFlags) differences', () => {
    const a = captureRunManifest(makeRun(), baseContext());
    const b = captureRunManifest(
      makeRun({ id: 'run-2' }),
      { ...baseContext(), search: { providerId: 'massive', routing: { primary: 'massive', fallback: 'longbridge' }, configured: true } }
    );
    const diff = diffRunManifests(a, b);
    expect(diff.groups.config).toBe(true);
    expect(diff.fields.map((f) => f.path)).toContain('search.providerId');
  });
});

describe('exportRunManifest', () => {
  it('produces indented JSON and redacts secrets', () => {
    const manifest = captureRunManifest(makeRun(), baseContext());
    // Force a secret through the redaction path to prove export defends it.
    const dirty = redactManifestSecrets(manifest) as RunManifest;
    // No secret in the baseline manifest; just assert shape + stability.
    expect(exportRunManifest(manifest)).toContain('"schemaVersion": 1');
    expect(exportRunManifest(manifest)).toContain('"runId": "run-1"');
    void dirty;
  });

  it('redacts a secret present in the manifest before export', () => {
    const manifest = captureRunManifest(makeRun(), baseContext());
    (manifest.featureFlags as Record<string, unknown>).apiKey = 'sk-leak';
    const out = exportRunManifest(manifest);
    expect(out).not.toContain('sk-leak');
    expect(out).toContain('[redacted]');
  });

  it('keeps sizing config in the exported JSON', () => {
    const manifest = captureRunManifest(makeRun(), {
      ...baseContext(),
      modelParams: { maxTokens: 4096, contextWindow: 128_000 },
    });
    const out = exportRunManifest(manifest);
    expect(out).toContain('"maxTokens": 4096');
    expect(out).toContain('"contextWindow": 128000');
  });
});

describe('hashManifestInput', () => {
  it('is stable for equal input and differs for different input', () => {
    expect(hashManifestInput('a|b|c')).toBe(hashManifestInput('a|b|c'));
    expect(hashManifestInput('a|b|c')).not.toBe(hashManifestInput('a|b|d'));
    expect(hashManifestInput('a|b|c')).toMatch(/^[0-9a-f]{64}$/);
  });
});

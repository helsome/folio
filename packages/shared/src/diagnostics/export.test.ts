import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeSupportBundle, writeSupportBundle } from './export.ts';
import { REDACTION_POLICY } from './redact.ts';
import type { DiagnosticsBundle } from './types.ts';

function makeBundle(): DiagnosticsBundle {
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
        { id: 'longbridge', status: 'connected', coverage: { capabilities: ['market.quote'], markets: ['US'] } },
      ],
      broker: { connected: true, accountCount: 1 },
      longbridgeCliVersion: '0.17.0',
    },
    skills: { loaded: 3 },
    capabilities: { available: ['market.quote'] },
    resources: { dev: true, root: '/repo' },
    errors: [
      // A secret smuggled into an error message must be stripped on export.
      { at: 1, source: 'main', message: 'request failed with key sk-abcdef1234567890', stack: null },
    ],
    redaction: { policy: REDACTION_POLICY, applied: false },
  };
}

describe('support bundle export', () => {
  it('serializes redacted JSON and marks redaction applied', () => {
    const json = serializeSupportBundle(makeBundle());
    expect(json).not.toContain('sk-abcdef1234567890');
    expect(json).toContain('[REDACTED]');
    const parsed = JSON.parse(json) as DiagnosticsBundle;
    expect(parsed.redaction.applied).toBe(true);
    expect(parsed.errors[0].message).toContain('[REDACTED]');
    expect(parsed.providers.llm.id).toBe('anthropic');
  });

  it('writes valid redacted JSON to a temp path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'folio-diag-'));
    const filePath = join(dir, 'bundle.json');
    try {
      await writeSupportBundle(makeBundle(), filePath);
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as DiagnosticsBundle;
      expect(parsed.collectedAt).toBe('2026-08-14T00:00:00.000Z');
      expect(raw).not.toContain('sk-abcdef1234567890');
      expect(parsed.redaction.policy.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves a clean bundle with applied=false', () => {
    const bundle = makeBundle();
    bundle.errors[0].message = 'a benign failure with no secrets';
    const json = serializeSupportBundle(bundle);
    expect(JSON.parse(json).redaction.applied).toBe(false);
  });
});

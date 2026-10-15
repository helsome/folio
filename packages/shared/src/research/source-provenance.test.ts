import { afterEach, describe, expect, it } from 'bun:test';
import type { CapabilityResult } from '@finagent/core';
import {
  createSourceProvenanceSnapshot,
  detectSourceDrift,
  refreshSourceSnapshot,
  snapshotCapabilityEvidence,
} from './source-provenance.ts';

describe('source provenance snapshots', () => {
  it('uses a stable source identity while preserving only the minimum evidence span', () => {
    const first = createSourceProvenanceSnapshot({
      canonicalUrl: 'https://example.test/article?utm_source=mail&a=1#section-2',
      title: 'Quarterly update',
      retrievedAt: 1_700_000_000_000,
      provider: 'test-news',
      method: 'search',
      excerpt: 'Revenue rose 10%.',
      sourceContent: 'Quarterly update\nRevenue rose 10%.',
      sourceVersion: 'v1',
    });
    const second = createSourceProvenanceSnapshot({
      canonicalUrl: 'https://example.test/article?a=1',
      title: 'Quarterly update',
      retrievedAt: 1_800_000_000_000,
      provider: 'test-news',
      method: 'search',
      excerpt: 'Revenue rose 10%.',
      sourceContent: 'Quarterly update\nRevenue rose 10%.',
      sourceVersion: 'v1',
    });

    expect(first.sourceId).toBe(second.sourceId);
    expect(first.canonicalUrl).toBe('https://example.test/article?a=1');
    expect(first).not.toHaveProperty('sourceContent');
    expect(first.excerptHash).toMatch(/^sha256:/);
    expect(first.sourceContentHash).toMatch(/^sha256:/);
  });

  it('snapshots each news source that actually reaches the research report path', () => {
    const result: CapabilityResult<unknown> = {
      data: [{
        id: 'wire-42',
        title: 'Issuer publishes results',
        summary: 'Revenue grew 10%.',
        url: 'https://news.example.test/results?utm_campaign=weekly',
        timestamp: 1_700_000_000,
        symbols: ['NVDA.US'],
      }],
      provenance: { provider: 'test-wire', fetchedAt: 1_700_000_001_000, stale: false },
    };

    const snapshots = snapshotCapabilityEvidence({
      capabilityId: 'research.news', result, retrievedAt: 1_700_000_001_000,
    });

    expect(snapshots).toEqual([expect.objectContaining({
      documentId: 'wire-42',
      canonicalUrl: 'https://news.example.test/results',
      title: 'Issuer publishes results',
      publishedAt: 1_700_000_000_000,
      retrievedAt: 1_700_000_001_000,
      retrieval: { provider: 'test-wire', method: 'capability:research.news' },
      excerpt: 'Issuer publishes results\n\nRevenue grew 10%.',
    })]);
  });

  it('reports v1 to v2 content changes and unavailable sources without replacing original evidence', async () => {
    let source = 'v1: revenue grew 10%.';
    let online = true;
    const server = Bun.serve({
      port: 0,
      fetch() {
        return online ? new Response(source) : new Response('gone', { status: 410 });
      },
    });
    try {
      const original = createSourceProvenanceSnapshot({
        canonicalUrl: `${server.url}article`,
        title: 'Issuer update',
        retrievedAt: 1_700_000_000_000,
        provider: 'controlled-test-server',
        method: 'deep-research-retrieval',
        excerpt: source,
        sourceContent: source,
        sourceVersion: 'v1',
      });
      const retrieve = async () => {
        const response = await fetch(`${server.url}article`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        return { available: true as const, canonicalUrl: `${server.url}article`, excerpt: text, sourceContent: text,
          sourceVersion: text.startsWith('v2') ? 'v2' : 'v1' };
      };

      expect(await refreshSourceSnapshot(original, retrieve)).toMatchObject({ status: 'current', reasons: [] });

      source = 'v2: revenue was restated to 6%.';
      const drifted = await refreshSourceSnapshot(original, retrieve);
      expect(drifted).toMatchObject({ status: 'source_drifted' });
      expect(drifted.reasons).toEqual(['content_changed', 'version_changed']);
      expect(drifted.original.excerpt).toBe('v1: revenue grew 10%.');

      online = false;
      expect(await refreshSourceSnapshot(original, retrieve)).toMatchObject({
        status: 'source_unavailable', reasons: ['unavailable'], original: { excerpt: 'v1: revenue grew 10%.' },
      });
    } finally {
      await server.stop(true);
    }
  });

  it('does not call an inaccessible live source current', () => {
    const original = createSourceProvenanceSnapshot({
      documentId: 'doc-1', retrievedAt: 1, provider: 'test', method: 'search', excerpt: 'original', sourceContent: 'original',
    });
    expect(detectSourceDrift(original, { available: false }).status).toBe('source_unavailable');
  });
});

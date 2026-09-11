import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CapabilityResult, Quote, CalcIndex } from '@finagent/core';
import {
  collectEvidence,
  JsonFileEvidenceRepository,
} from './index.ts';
import type { EvidenceRepository } from './index.ts';

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeQuote(): Quote {
  return {
    symbol: 'NVDA.US',
    lastPrice: 185.50,
    change: 2.35,
    changePercent: 1.28,
    volume: 45000000,
    timestamp: 1726000000,
    high: 186.20,
    low: 183.10,
    open: 183.50,
    prevClose: 183.15,
  };
}

function makeValuation(): CalcIndex {
  return {
    symbol: 'NVDA.US',
    pe: 65.4,
    pb: 45.2,
    dpsRate: 0.03,
    totalMarketValue: 4500000000000,
    turnoverRate: 2.1,
    ytdChangeRate: 128.5,
  };
}

function makeQuoteResult(): CapabilityResult<Quote> {
  return {
    data: makeQuote(),
    provenance: {
      provider: 'longbridge',
      fetchedAt: 1726000000000,
      marketTime: 1726000000,
      stale: false,
    },
    summary: 'NVDA: $185.50 +1.28%',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('collectEvidence', () => {
  test('generates evidence envelope from quote result', () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-1',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        marketTime: 1726000000,
        stale: false,
      },
    };

    const envelope = collectEvidence({
      runRecord,
      result: makeQuoteResult(),
      input: { symbol: 'NVDA.US' },
      agentRunId: 'agent-run-123',
    });

    expect(envelope).not.toBeNull();
    expect(envelope!.evidenceId).toContain('run-market.quote');
    expect(envelope!.capabilityId).toBe('market.quote');
    expect(envelope!.instrumentId).toBe('NVDA.US');
    expect(envelope!.provider).toBe('longbridge');
    expect(envelope!.metrics.length).toBeGreaterThan(0);

    // Check that quote metrics are extracted
    const metricIds = envelope!.metrics.map((m) => m.metricId);
    expect(metricIds).toContain('quote.lastPrice');
    expect(metricIds).toContain('quote.changePercent');
    expect(metricIds).toContain('quote.volume');

    // Check lineage
    expect(envelope!.lineage.length).toBeGreaterThan(0);
    expect(envelope!.lineage[0].step).toBe('provider_fetch');

    // Check snapshot hash
    expect(envelope!.snapshotHash).toBeDefined();
    expect(envelope!.snapshotHash!.length).toBe(16);
  });

  test('generates evidence envelope from valuation result', () => {
    const runRecord = {
      id: 'run-company.valuation-1726000000000-2',
      capabilityId: 'company.valuation',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        stale: false,
      },
    };

    const result: CapabilityResult<CalcIndex> = {
      data: makeValuation(),
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        stale: false,
      },
      summary: 'PE: 65.4 · PB: 45.2',
    };

    const envelope = collectEvidence({
      runRecord,
      result,
      input: { symbol: 'NVDA.US' },
      agentRunId: 'agent-run-123',
    });

    expect(envelope).not.toBeNull();
    expect(envelope!.capabilityId).toBe('company.valuation');
    const metricIds = envelope!.metrics.map((m) => m.metricId);
    expect(metricIds).toContain('valuation.pe');
    expect(metricIds).toContain('valuation.pb');
  });

  test('returns null for failed runs', () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-3',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'failed' as const,
      error: 'Timeout',
    };

    const envelope = collectEvidence({
      runRecord,
      result: undefined as unknown as CapabilityResult<unknown>,
      input: { symbol: 'NVDA.US' },
    });

    expect(envelope).toBeNull();
  });

  test('sanitizes secrets from query params', () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-4',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        stale: false,
      },
    };

    const envelope = collectEvidence({
      runRecord,
      result: makeQuoteResult(),
      input: { symbol: 'NVDA.US', apiKey: 'secret123', token: 'abc' },
    });

    expect(envelope).not.toBeNull();
    expect(envelope!.queryParams.symbol).toBe('NVDA.US');
    expect(envelope!.queryParams.apiKey).toBeUndefined();
    expect(envelope!.queryParams.token).toBeUndefined();
  });
});

describe('JsonFileEvidenceRepository', () => {
  let repo: EvidenceRepository;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'evidence-test-'));
    repo = new JsonFileEvidenceRepository(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('saves and retrieves evidence envelope by runId', async () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-5',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        marketTime: 1726000000,
        stale: false,
      },
    };

    const envelope = collectEvidence({
      runRecord,
      result: makeQuoteResult(),
      input: { symbol: 'NVDA.US' },
      sessionId: 'session-123',
    });

    expect(envelope).not.toBeNull();
    await repo.save(envelope!);

    // Retrieve by runId
    const byRun = await repo.getByRunId('run-market.quote-1726000000000-5');
    expect(byRun.length).toBe(1);
    expect(byRun[0].evidenceId).toBe(envelope!.evidenceId);
    expect(byRun[0].instrumentId).toBe('NVDA.US');
  });

  test('persists evidence across "restart" (new repo instance)', async () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-6',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        marketTime: 1726000000,
        stale: false,
      },
    };

    const envelope = collectEvidence({
      runRecord,
      result: makeQuoteResult(),
      input: { symbol: 'NVDA.US' },
      sessionId: 'session-456',
    });

    await repo.save(envelope!);

    // Simulate app restart: create a new repo instance pointing to same dir
    const repo2 = new JsonFileEvidenceRepository(tempDir);
    const bySession = await repo2.getBySessionId('session-456');
    expect(bySession.length).toBe(1);
    expect(bySession[0].evidenceId).toBe(envelope!.evidenceId);
    expect(bySession[0].metrics.length).toBeGreaterThan(0);
  });

  test('retrieves evidence by instrument', async () => {
    const runRecord = {
      id: 'run-market.quote-1726000000000-7',
      capabilityId: 'market.quote',
      startedAt: 1726000000000,
      finishedAt: 1726000001000,
      durationMs: 1000,
      status: 'success' as const,
      provenance: {
        provider: 'longbridge',
        fetchedAt: 1726000000000,
        marketTime: 1726000000,
        stale: false,
      },
    };

    const envelope = collectEvidence({
      runRecord,
      result: makeQuoteResult(),
      input: { symbol: 'NVDA.US' },
    });

    await repo.save(envelope!);

    const byInstrument = await repo.getByInstrument('NVDA.US');
    expect(byInstrument.length).toBe(1);
    expect(byInstrument[0].instrumentId).toBe('NVDA.US');
  });
});

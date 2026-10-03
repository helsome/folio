import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { EvidenceRef, ResearchReport } from '@finagent/core';
import { EVIDENCE_CONTRACT_SCHEMA_VERSION } from '@finagent/core';
import { buildReportEvidenceBundle } from '../evidence/contract.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchReportRepository } from './repository.ts';

let dir = '';
let store: JsonFileStore;
let repository: ResearchReportRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-research-evidence-'));
  store = new JsonFileStore(dir);
  repository = new ResearchReportRepository(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function evidenceRef(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    capabilityId: 'market.quote',
    runId: 'run-1',
    claim: 'NVDA valuation is expensive',
    fetchedAt: 1_700_000_000_000,
    summary: 'pe 35.2',
    instrumentId: 'NVDA.US',
    ...overrides,
  };
}

function report(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'report-1',
    symbol: 'NVDA.US',
    generatedAt: 1_700_000_000_000,
    summary: 'summary',
    stance: 'neutral',
    confidence: 0.5,
    sections: [
      {
        key: 'valuation',
        title: 'Valuation',
        verdict: 'neutral',
        summary: 'valuation summary',
        evidence: [evidenceRef()],
      },
      {
        key: 'fundamentals',
        title: 'Fundamentals',
        verdict: 'neutral',
        summary: 'fundamentals summary',
        evidence: [evidenceRef({ capabilityId: 'company.financials', claim: 'Gross margin stable', summary: 'margin 45%' })],
      },
    ],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'completed',
    ...overrides,
  };
}

describe('report evidence bundle persistence', () => {
  it('persists a bundle on saveReport that matches the deterministic projection', async () => {
    const saved = report();
    await repository.saveReport(saved);
    const bundle = await repository.getEvidenceBundle('report-1');
    expect(bundle).toEqual(buildReportEvidenceBundle(saved));
    expect(bundle!.schemaVersion).toBe(EVIDENCE_CONTRACT_SCHEMA_VERSION);
    expect(bundle!.evidence).toHaveLength(2);
    expect(bundle!.claims).toHaveLength(2);
    for (const claim of bundle!.claims) {
      expect(claim.verification).toBe('unverified');
      expect(claim.evidenceIds.every((id) => bundle!.evidence.some((item) => item.evidenceId === id))).toBe(true);
    }
  });

  it('keeps ids stable across save → reload → rebuild', async () => {
    const saved = report();
    await repository.saveReport(saved);
    const reloaded = await repository.getEvidenceBundle('report-1');
    const rebuilt = buildReportEvidenceBundle(saved);
    expect(reloaded!.sources).toEqual(rebuilt.sources);
    expect(reloaded!.evidence).toEqual(rebuilt.evidence);
    expect(reloaded!.claims).toEqual(rebuilt.claims);
    // Saving the same report again re-derives the identical bundle.
    await repository.saveReport(saved);
    expect(await repository.getEvidenceBundle('report-1')).toEqual(reloaded);
  });

  it('merges identical claim statements across sections', async () => {
    const saved = report({
      sections: [{
        key: 'valuation',
        title: 'Valuation',
        verdict: 'neutral',
        summary: 'valuation summary',
        evidence: [evidenceRef(), evidenceRef({ runId: 'run-2', summary: 'pe 36' })],
      }],
    });
    await repository.saveReport(saved);
    const bundle = await repository.getEvidenceBundle('report-1');
    expect(bundle!.claims).toHaveLength(1);
    expect(bundle!.claims[0]!.evidenceIds).toHaveLength(2);
    expect(bundle!.evidence).toHaveLength(2);
  });

  it('returns undefined for reports saved before bundles existed', async () => {
    // Legacy layout: only the report file, no evidence file.
    await store.write('research/reports/legacy-1.json', report({ id: 'legacy-1' }));
    expect(await repository.getReport('legacy-1')).toBeDefined();
    expect(await repository.getEvidenceBundle('legacy-1')).toBeUndefined();
  });

  it('returns undefined for a corrupt bundle file instead of throwing', async () => {
    await repository.saveReport(report());
    await writeFile(join(dir, 'research', 'evidence', 'report-1.json'), '{not json', 'utf8');
    expect(await repository.getEvidenceBundle('report-1')).toBeUndefined();
  });

  it('rejects invalid report ids', async () => {
    await expect(repository.getEvidenceBundle('../escape')).rejects.toThrow('Invalid research report id.');
  });

  it('persists a valid empty bundle for a report without evidence', async () => {
    await repository.saveReport(report({ sections: [] }));
    const bundle = await repository.getEvidenceBundle('report-1');
    expect(bundle).toEqual({
      schemaVersion: EVIDENCE_CONTRACT_SCHEMA_VERSION,
      sources: [],
      evidence: [],
      claims: [],
    });
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ResearchReport } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchReportRepository } from './repository.ts';
import {
  buildClaimEvidenceIndex,
  claimIdOf,
  claimsForEvidence,
  collectReportClaims,
  evidenceForClaim,
  evidenceIdOf,
  findUnbackedClaims,
} from './claim-evidence.ts';

const VALUATION_EVIDENCE = evidenceIdOf('run-v', 'company.valuation');

/** Report shaped the way the runner assembles it today: ids already linked. */
function linkedReport(): ResearchReport {
  return {
    id: 'report-run-1',
    symbol: 'NVDA.US',
    generatedAt: 1_700_000_000_000,
    summary: 'summary',
    stance: 'bullish',
    confidence: 0.6,
    sections: [
      {
        key: 'valuation',
        title: 'Valuation',
        verdict: 'negative',
        summary: 'NVDA trades at a premium multiple.',
        evidence: [
          {
            id: VALUATION_EVIDENCE,
            capabilityId: 'company.valuation',
            runId: 'run-v',
            claim: 'NVDA trades at a premium multiple.',
            claimId: claimIdOf('valuation'),
            fetchedAt: 1_700_000_000_000,
            summary: 'PE 45',
          },
        ],
      },
      {
        key: 'momentum',
        title: 'Momentum',
        verdict: 'unavailable',
        summary: 'Momentum data unavailable.',
        evidence: [],
      },
    ],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [
      { runId: 'run-v', capabilityId: 'company.valuation', status: 'success' },
      { runId: 'missing:market.momentum', capabilityId: 'market.momentum', status: 'unavailable' },
    ],
    claims: [
      {
        id: claimIdOf('valuation'),
        sectionKey: 'valuation',
        text: 'NVDA trades at a premium multiple.',
        evidenceRefs: [VALUATION_EVIDENCE],
      },
      {
        id: claimIdOf('momentum'),
        sectionKey: 'momentum',
        text: 'Momentum data unavailable.',
        evidenceRefs: [],
      },
    ],
    runStatus: 'partial',
  };
}

/** Report persisted before claim linking existed: no `claims`, no ids. */
function legacyReport(): ResearchReport {
  return {
    id: 'report-legacy',
    symbol: 'AAPL.US',
    generatedAt: 1_700_000_000_000,
    summary: 'summary',
    stance: 'neutral',
    confidence: 0.4,
    sections: [
      {
        key: 'growth',
        title: 'Growth',
        verdict: 'positive',
        summary: 'Revenue compounding.',
        evidence: [
          {
            capabilityId: 'company.financials',
            runId: 'run-g',
            claim: 'Revenue grew 18% YoY.',
            fetchedAt: 1_700_000_000_000,
          },
        ],
      },
    ],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [{ runId: 'run-g', capabilityId: 'company.financials', status: 'success' }],
    runStatus: 'completed',
  };
}

describe('claim and evidence ids', () => {
  it('derives ids from data the report already carries', () => {
    expect(evidenceIdOf('run-1', 'market.quote')).toBe('evidence:run-1:market.quote');
    expect(claimIdOf('valuation')).toBe('claim:valuation:0');
    expect(claimIdOf('valuation', 2)).toBe('claim:valuation:2');
  });
});

describe('buildClaimEvidenceIndex', () => {
  it('walks claim → evidence and evidence → claim', () => {
    const index = buildClaimEvidenceIndex(linkedReport());
    expect(index.claimToEvidence['claim:valuation:0']).toEqual([VALUATION_EVIDENCE]);
    expect(index.evidenceToClaims[VALUATION_EVIDENCE]).toEqual(['claim:valuation:0']);
  });

  it('keeps a claim nothing backs visible as an empty edge', () => {
    expect(buildClaimEvidenceIndex(linkedReport()).claimToEvidence['claim:momentum:0']).toEqual([]);
  });

  it('supports several claims backed by the same evidence (many-to-many)', () => {
    const report = linkedReport();
    report.claims = [
      {
        id: claimIdOf('valuation'),
        sectionKey: 'valuation',
        text: 'Premium multiple.',
        evidenceRefs: [VALUATION_EVIDENCE],
      },
      {
        id: claimIdOf('growth'),
        sectionKey: 'growth',
        text: 'Growth still compounding.',
        evidenceRefs: [VALUATION_EVIDENCE],
      },
    ];

    const index = buildClaimEvidenceIndex(report);
    expect(index.evidenceToClaims[VALUATION_EVIDENCE]).toEqual([
      'claim:valuation:0',
      'claim:growth:0',
    ]);
    expect(index.claimToEvidence['claim:growth:0']).toEqual([VALUATION_EVIDENCE]);
  });

  it('rebuilds the same links for a report written before claim linking', () => {
    const report = legacyReport();
    const index = buildClaimEvidenceIndex(report);

    expect(index.claimToEvidence['claim:growth:0']).toEqual([
      evidenceIdOf('run-g', 'company.financials'),
    ]);
    expect(index.evidenceToClaims[evidenceIdOf('run-g', 'company.financials')]).toEqual([
      'claim:growth:0',
    ]);
    expect(collectReportClaims(report)).toEqual([
      {
        id: 'claim:growth:0',
        sectionKey: 'growth',
        text: 'Revenue grew 18% YoY.',
        evidenceRefs: [evidenceIdOf('run-g', 'company.financials')],
      },
    ]);
  });
});

describe('claim ↔ evidence lookups', () => {
  it('resolves evidence for a claim and claims for a piece of evidence', () => {
    const report = linkedReport();
    expect(evidenceForClaim(report, 'claim:valuation:0').map((ref) => ref.runId)).toEqual(['run-v']);
    expect(claimsForEvidence(report, VALUATION_EVIDENCE).map((claim) => claim.id)).toEqual([
      'claim:valuation:0',
    ]);
  });

  it('returns nothing for unknown ids', () => {
    const report = linkedReport();
    expect(evidenceForClaim(report, 'claim:nope:0')).toEqual([]);
    expect(claimsForEvidence(report, 'evidence:nope')).toEqual([]);
  });

  it('names the claims nothing backs', () => {
    expect(findUnbackedClaims(linkedReport()).map((claim) => claim.id)).toEqual([
      'claim:momentum:0',
    ]);
    expect(findUnbackedClaims(legacyReport())).toEqual([]);
  });
});

describe('claim links across persistence', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finagent-claim-evidence-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves the same links after save + reload', async () => {
    const report = linkedReport();
    await new ResearchReportRepository(new JsonFileStore(dir)).saveReport(report);

    const reloaded = await new ResearchReportRepository(new JsonFileStore(dir)).getReport(
      report.id
    );
    expect(reloaded).toBeDefined();
    expect(buildClaimEvidenceIndex(reloaded!)).toEqual(buildClaimEvidenceIndex(report));
    expect(claimsForEvidence(reloaded!, VALUATION_EVIDENCE).map((claim) => claim.id)).toEqual([
      'claim:valuation:0',
    ]);
    expect(findUnbackedClaims(reloaded!).map((claim) => claim.id)).toEqual(['claim:momentum:0']);
  });
});

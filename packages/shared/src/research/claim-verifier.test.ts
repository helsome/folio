import { describe, expect, it } from 'bun:test';
import type { EvidenceRef, ResearchReport } from '@finagent/core';
import type { JudgeClient } from '../evaluation/judge-client.ts';
import { buildReportEvidenceBundle } from '../evidence/contract.ts';
import {
  CLAIM_VERIFIER_VERSION,
  createClaimVerifier,
  verifyReportClaims,
  type ClaimVerificationInput,
  type ClaimVerificationResult,
  type ClaimVerifier,
} from './claim-verifier.ts';
function input(
  claimText: string,
  evidence: ClaimVerificationInput['evidence'],
): ClaimVerificationInput {
  return { claimId: 'claim-1', claimText, evidence };
}

function judgeReturning(reply: string): JudgeClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    provider: 'test',
    model: 'test-judge',
    calls,
    async complete(system, user) {
      calls.push({ system, user });
      return reply;
    },
  };
}

function evidenceRef(claim: string, summary?: string, overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    capabilityId: 'sec.filing',
    runId: 'filing-run',
    claim,
    fetchedAt: 1_700_000_000_000,
    summary,
    instrumentId: 'NVDA.US',
    ...overrides,
  };
}

function reportWithEvidence(sections: EvidenceRef[][]): ResearchReport {
  return {
    id: 'report-123',
    symbol: 'NVDA.US',
    generatedAt: 1_700_000_000_000,
    summary: 'Fixture report',
    stance: 'neutral',
    confidence: 0.5,
    sections: sections.map((evidence, index) => ({
      key: `section-${index}`,
      title: `Section ${index}`,
      verdict: 'neutral',
      summary: 'Fixture section',
      evidence,
    })),
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'completed',
  };
}

describe('claim verifier', () => {
  it('returns insufficient_evidence without calling the judge when evidence is empty', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"invented"}');
    const result = await createClaimVerifier(judge).verify(input('Revenue increased.', []));

    expect(result).toEqual({
      claimId: 'claim-1',
      status: 'insufficient_evidence',
      evidenceIds: [],
      reason: 'No source evidence was provided for this claim.',
      verifierVersion: CLAIM_VERIFIER_VERSION,
    });
    expect(judge.calls).toHaveLength(0);
  });

  it('returns supported when the supplied evidence directly supports the claim', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"The filing reports the same revenue increase."}');
    const result = await createClaimVerifier(judge).verify(
      input('Revenue increased by 12%.', [{ id: 'e-1', content: 'The filing reports revenue increased by 12%.' }]),
    );

    expect(result.status).toBe('supported');
    expect(result.evidenceIds).toEqual(['e-1']);
  });

  it('returns contradicted when the supplied evidence directly contradicts the claim', async () => {
    const judge = judgeReturning('{"status":"contradicted","reason":"The filing reports a decline, not an increase."}');
    const result = await createClaimVerifier(judge).verify(
      input('Revenue increased by 12%.', [{ id: 'e-1', content: 'Revenue declined by 12%.' }]),
    );

    expect(result.status).toBe('contradicted');
  });

  it('returns insufficient_evidence when evidence is related but does not establish the claim', async () => {
    const judge = judgeReturning('{"status":"insufficient_evidence","reason":"The evidence discusses demand but gives no revenue result."}');
    const result = await createClaimVerifier(judge).verify(
      input('Revenue increased by 12%.', [{ id: 'e-1', content: 'Customer demand remained strong.' }]),
    );

    expect(result.status).toBe('insufficient_evidence');
  });

  it('does not accept a plausible root-cause claim without causal evidence', async () => {
    const judge = judgeReturning('{"status":"insufficient_evidence","reason":"The evidence shows both events but no causal link."}');
    const result = await createClaimVerifier(judge).verify(
      input('The share-price decline was caused by supply constraints.', [
        { id: 'e-1', content: 'The share price declined after the earnings release.' },
        { id: 'e-2', content: 'The company separately reported supply constraints.' },
      ]),
    );

    expect(result.status).toBe('insufficient_evidence');
    expect(result.evidenceIds).toEqual(['e-1', 'e-2']);
  });

  it('supports a claim using multiple supplied evidence items', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"The two filings jointly establish the claim."}');
    const result = await createClaimVerifier(judge).verify(
      input('Revenue and operating margin both increased.', [
        { id: 'e-revenue', content: 'Revenue increased by 12%.' },
        { id: 'e-margin', content: 'Operating margin increased by 2 percentage points.' },
      ]),
    );

    expect(result).toEqual({
      claimId: 'claim-1',
      status: 'supported',
      evidenceIds: ['e-revenue', 'e-margin'],
      reason: 'The two filings jointly establish the claim.',
      verifierVersion: CLAIM_VERIFIER_VERSION,
    });
  });

  it('fails closed when the judge returns malformed JSON or an unknown status', async () => {
    for (const reply of [
      'not json',
      '{"status":"probably_supported","reason":"maybe"}',
      '{"status":"supported"}',
    ]) {
      const result = await createClaimVerifier(judgeReturning(reply)).verify(
        input('Revenue increased.', [{ id: 'e-1', content: 'Revenue increased.' }]),
      );

      expect(result.status).toBe('insufficient_evidence');
      expect(result.reason).toStartWith('judge_error:');
    }
  });

  it('fails closed when judge transport fails', async () => {
    const failingJudge: JudgeClient = {
      provider: 'test',
      model: 'test-judge',
      async complete() {
        throw new Error('network unavailable');
      },
    };

    const result = await createClaimVerifier(failingJudge).verify(
      input('Revenue increased.', [{ id: 'e-1', content: 'Revenue increased.' }]),
    );

    expect(result.status).toBe('insufficient_evidence');
    expect(result.reason).toBe('judge_error: network unavailable');
  });

  it('instructs the judge to use only supplied evidence and never promotes reason to evidence', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"Explanation only."}');
    const result = await createClaimVerifier(judge).verify(
      input('Revenue increased.', [{ id: 'source-evidence', content: 'Revenue increased.' }]),
    );

    expect(judge.calls[0].system).toContain('ONLY the supplied source evidence');
    expect(judge.calls[0].system).toContain('Do not use background knowledge');
    expect(result.evidenceIds).toEqual(['source-evidence']);
    expect(result.evidenceIds).not.toContain('Explanation only.');
  });

  it('aggregates canonical report bundle claims with a mock judge (fixture)', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"Confirmed by filing excerpt."}');
    const verifier = createClaimVerifier(judge);
    const report = reportWithEvidence([
      [
        evidenceRef('Revenue rose 10%', 'SEC 10-Q filing notes 10% revenue increase'),
        evidenceRef('Gross margin expanded', 'Margin up 150bps', { runId: 'margin-run' }),
      ],
      [evidenceRef('Revenue rose 10%', 'Same claim in conclusion', { runId: 'conclusion-run' })],
    ]);
    const bundle = buildReportEvidenceBundle(report);
    const summary = await verifyReportClaims(report, verifier);

    expect(summary.reportId).toBe('report-123');
    expect(summary.totalClaims).toBe(2);
    expect(summary.supported).toBe(2);
    expect(summary.contradicted).toBe(0);
    expect(summary.insufficientEvidence).toBe(0);
    expect(summary.results).toHaveLength(2);
    expect(judge.calls).toHaveLength(2);
    for (const result of summary.results) {
      const claim = bundle.claims.find((candidate) => candidate.claimId === result.claimId);
      expect(claim).toBeDefined();
      expect(result.evidenceIds).toEqual(claim!.evidenceIds);
      for (const id of result.evidenceIds) {
        const item = bundle.evidence.find((candidate) => candidate.evidenceId === id);
        expect(item).toBeDefined();
        expect(bundle.sources.some((source) => source.sourceId === item!.sourceId)).toBe(true);
      }
    }
  });

  it('preserves canonical claim and evidence identities when unrelated sections are inserted or reordered', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"Confirmed."}');
    const verifier = createClaimVerifier(judge);
    const cashFlow = evidenceRef('Free cash flow increased', 'FCF up 20% YoY', { runId: 'fcf-run' });
    const margin = evidenceRef('Gross margin expanded', 'Margin up 150bps', { runId: 'margin-run' });
    const unrelated = evidenceRef('Unrelated intro fact', 'Company founded in 2010', { runId: 'intro-run' });
    const baseReport = reportWithEvidence([[cashFlow], [margin]]);
    const prependedReport = reportWithEvidence([[unrelated], [margin], [cashFlow]]);
    const baseBundle = buildReportEvidenceBundle(baseReport);
    const prependedBundle = buildReportEvidenceBundle(prependedReport);
    const baseSummary = await verifyReportClaims(baseReport, verifier);
    const prependedSummary = await verifyReportClaims(prependedReport, verifier);
    for (const statement of [cashFlow.claim, margin.claim]) {
      const original = baseBundle.claims.find((claim) => claim.statement === statement)!;
      const reordered = prependedBundle.claims.find((claim) => claim.statement === statement)!;
      expect(reordered.claimId).toBe(original.claimId);
      expect(reordered.evidenceIds).toEqual(original.evidenceIds);
      expect(baseSummary.results.find((result) => result.claimId === original.claimId)?.evidenceIds).toEqual(original.evidenceIds);
      expect(prependedSummary.results.find((result) => result.claimId === original.claimId)?.evidenceIds).toEqual(original.evidenceIds);
      for (const id of original.evidenceIds) {
        const originalItem = baseBundle.evidence.find((item) => item.evidenceId === id)!;
        const reorderedItem = prependedBundle.evidence.find((item) => item.evidenceId === id)!;
        expect(reorderedItem).toEqual(originalItem);
        expect(prependedBundle.sources.find((source) => source.sourceId === reorderedItem.sourceId)).toEqual(
          baseBundle.sources.find((source) => source.sourceId === originalItem.sourceId)
        );
      }
    }
  });

  it('fails closed when a projected claim has no factual excerpt (fixture)', async () => {
    const judge = judgeReturning('{"status":"supported","reason":"Invented."}');
    const report = reportWithEvidence([[evidenceRef('Revenue rose 10%')]]);
    const summary = await verifyReportClaims(report, createClaimVerifier(judge));
    expect(summary.results[0]?.status).toBe('insufficient_evidence');
    expect(summary.results[0]?.evidenceIds).toEqual([]);
    expect(judge.calls).toHaveLength(0);
  });

  it('does not return evidence identities invented by a verifier (fixture)', async () => {
    const report = reportWithEvidence([[evidenceRef('Revenue rose 10%', 'Filing reports a 10% rise')]]);
    const verifier: ClaimVerifier = {
      async verify({ claimId }) {
        return {
          claimId,
          status: 'supported',
          evidenceIds: ['ev_missing'],
          reason: 'Unsupported identity',
          verifierVersion: CLAIM_VERIFIER_VERSION,
        };
      },
    };
    const summary = await verifyReportClaims(report, verifier);
    expect(summary.results[0]?.status).toBe('insufficient_evidence');
    expect(summary.results[0]?.evidenceIds).toEqual([]);
  });

  it('fails closed when a verifier returns an unknown status (fixture)', async () => {
    const report = reportWithEvidence([[evidenceRef('Revenue rose 10%', 'Filing reports a 10% rise')]]);
    const bundle = buildReportEvidenceBundle(report);
    const verifier: ClaimVerifier = {
      async verify({ claimId }) {
        return {
          claimId,
          status: 'unknown' as ClaimVerificationResult['status'],
          evidenceIds: bundle.claims[0]!.evidenceIds,
          reason: 'Unexpected status',
          verifierVersion: CLAIM_VERIFIER_VERSION,
        };
      },
    };
    const summary = await verifyReportClaims(report, verifier);
    expect(summary.results[0]?.status).toBe('insufficient_evidence');
    expect(summary.results[0]?.evidenceIds).toEqual([]);
    expect(summary.insufficientEvidence).toBe(1);
  });

  it('rejects positive verdicts without a valid evidence id list (fixture)', async () => {
    const report = reportWithEvidence([[evidenceRef('Revenue rose 10%', 'Filing reports a 10% rise')]]);
    const invalidResults: Array<{ status: 'supported' | 'contradicted'; evidenceIds: unknown }> = [
      { status: 'supported', evidenceIds: [] },
      { status: 'contradicted', evidenceIds: [] },
      { status: 'supported', evidenceIds: undefined },
      { status: 'supported', evidenceIds: 'ev_not_an_array' },
    ];
    for (const { status, evidenceIds } of invalidResults) {
      const verifier: ClaimVerifier = {
        async verify({ claimId }) {
          return {
            claimId,
            status,
            evidenceIds: evidenceIds as string[],
            reason: 'Verdict without a resolvable evidence reference',
            verifierVersion: CLAIM_VERIFIER_VERSION,
          };
        },
      };
      const summary = await verifyReportClaims(report, verifier);
      expect(summary.results[0]?.status).toBe('insufficient_evidence');
      expect(summary.results[0]?.evidenceIds).toEqual([]);
    }
  });
});

import { describe, expect, it } from 'bun:test';
import type { JudgeClient } from '../evaluation/judge-client.ts';
import {
  CLAIM_VERIFIER_VERSION,
  createClaimVerifier,
  type ClaimVerificationInput,
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
});

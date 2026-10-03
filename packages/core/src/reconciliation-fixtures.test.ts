import { describe, expect, it } from 'bun:test';
import { reconcileFinancialFacts } from './reconciliation.ts';
import { PROVIDER_DISAGREEMENT_CASES } from './reconciliation-fixtures.ts';

describe('provider disagreement fixtures', () => {
  it('covers the required disagreement classifications', () => {
    const states = PROVIDER_DISAGREEMENT_CASES.map((fixture) => fixture.expectedState);
    expect(states).toEqual(
      expect.arrayContaining(['material-conflict', 'within-tolerance', 'incomparable', 'insufficient-sources'])
    );
  });

  for (const fixture of PROVIDER_DISAGREEMENT_CASES) {
    it(`keeps "${fixture.name}" auditable without averaging`, () => {
      const result = reconcileFinancialFacts(fixture.candidates, fixture.policy);
      expect(result.state).toBe(fixture.expectedState);
      expect(result.policyVersion).toBe(fixture.policy.version);
      expect(result.sourceCount).toBe(fixture.candidates.length);
      expect(result.candidates).toEqual(fixture.candidates);

      if (result.state === 'material-conflict') {
        const values = fixture.candidates.map((candidate) => candidate.value);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        expect(values).not.toContain(mean);
        expect(result.reason).toContain('never averaged');
        expect(result.selected).toBeDefined();
        expect(result.selectedReason).toContain('policy priority');
      } else if (result.state === 'within-tolerance' || result.state === 'agreement') {
        expect(result.selected).toBeDefined();
        expect(result.selectedReason).toBeTruthy();
      } else {
        expect(result.selected).toBeUndefined();
      }
    });
  }
});

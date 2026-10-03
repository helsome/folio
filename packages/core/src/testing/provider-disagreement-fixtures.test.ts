import { describe, expect, it } from 'bun:test';
import { reconcileFinancialFacts } from '../reconciliation.ts';
import { FIXTURE_INSTRUMENT, PROVIDER_DISAGREEMENT_CASES } from './provider-disagreement-fixtures.ts';

function fixtureNamed(name: string) {
  const fixture = PROVIDER_DISAGREEMENT_CASES.find((entry) => entry.name === name);
  if (!fixture) throw new Error(`Missing provider disagreement fixture: ${name}`);
  return fixture;
}

describe('provider disagreement fixtures', () => {
  it('covers the required disagreement classifications', () => {
    const states = PROVIDER_DISAGREEMENT_CASES.map((fixture) => fixture.expectedState);
    expect(states).toEqual(
      expect.arrayContaining(['material-conflict', 'within-tolerance', 'incomparable', 'insufficient-sources'])
    );
  });

  it('attributes every candidate to the fixture instrument', () => {
    for (const fixture of PROVIDER_DISAGREEMENT_CASES) {
      expect(fixture.candidates.length).toBeGreaterThan(0);
      for (const candidate of fixture.candidates) {
        expect(candidate.instrument).toBe(FIXTURE_INSTRUMENT);
      }
    }
  });

  for (const fixture of PROVIDER_DISAGREEMENT_CASES) {
    it(`classifies "${fixture.name}" as ${fixture.expectedState}`, () => {
      const result = reconcileFinancialFacts(fixture.candidates, fixture.policy);

      expect(result.state).toBe(fixture.expectedState);
      expect(result.candidates).toEqual(fixture.candidates);
    });
  }

  for (const fixture of PROVIDER_DISAGREEMENT_CASES) {
    it(`reports auditable counts for "${fixture.name}" without averaging`, () => {
      const result = reconcileFinancialFacts(fixture.candidates, fixture.policy);

      expect(result.sourceCount).toBe(fixture.candidates.length);
      expect(result.policyVersion).toBe(fixture.policy.version);

      if (result.state === 'incomparable' || result.state === 'insufficient-sources') {
        expect(result.selected).toBeUndefined();
        return;
      }

      // The selection is always one of the reported candidates, never a blend
      // of them, so a silently averaged value would fail here.
      const selected = result.selected;
      if (!selected) throw new Error(`Expected a selection for "${fixture.name}"`);
      expect(fixture.candidates.map((candidate) => candidate.value)).toContain(selected.value);
      expect(result.selectedReason).toBeTruthy();
    });
  }

  it('names the priority provider when the policy configures one', () => {
    const fixture = fixtureNamed('revised vs stale trailing EPS');
    const result = reconcileFinancialFacts(fixture.candidates, fixture.policy);

    expect(result.state).toBe('material-conflict');
    expect(result.selected?.provider).toBe('longbridge');
    expect(result.selected?.value).toBe(2.41);
    expect(result.selectedReason).toContain('policy priority');
    expect(result.discrepancy).toBeCloseTo(0.49, 10);
    expect(result.reason).toContain('never averaged');
  });

  it('falls back to the first candidate when no priority is configured', () => {
    const fixture = fixtureNamed('no provider priority configured');
    const result = reconcileFinancialFacts(fixture.candidates, fixture.policy);

    expect(result.state).toBe('material-conflict');
    expect(result.selected?.provider).toBe('longbridge');
    expect(result.selected?.value).toBe(100);
    expect(result.selectedReason).toBe('No provider priority configured; first candidate retained.');
    expect(result.candidates).toHaveLength(2);
  });
});

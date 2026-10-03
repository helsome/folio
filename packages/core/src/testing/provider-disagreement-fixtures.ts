import type { FinancialFactCandidate, ReconciliationPolicy, ReconciliationState } from '../reconciliation.ts';

/**
 * FAKE / SAMPLE DATA ONLY. Every value below is synthetic; the provider names
 * exist to exercise the priority policy, and nothing here is captured live
 * provider output.
 *
 * Reproducible provider disagreement cases for #26. Each fixture pins the
 * reconciliation policy and expected classification so route-level audits can
 * rerun the same disagreement in CI instead of relying on live provider data.
 *
 * Test-only module: it is deliberately NOT re-exported from `src/index.ts`, so
 * these fixtures stay out of the `@finagent/core` public surface, matching the
 * `longbridge-tools/src/testing` convention.
 */
export interface ProviderDisagreementFixture {
  name: string;
  description: string;
  candidates: FinancialFactCandidate[];
  policy: ReconciliationPolicy;
  expectedState: ReconciliationState;
}

/** The instrument every candidate in this module is attributed to. */
export const FIXTURE_INSTRUMENT = 'AAPL';

export const PROVIDER_DISAGREEMENT_CASES: ProviderDisagreementFixture[] = [
  {
    name: 'revised vs stale trailing EPS',
    description:
      'One provider republished 2025Q4 EPS after the earnings release while another still returns the earlier figure for the same period and reported adjustment.',
    candidates: [
      { provider: 'longbridge', instrument: FIXTURE_INSTRUMENT, value: 2.41, asOf: 1769634000000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
      { provider: 'refinitiv', instrument: FIXTURE_INSTRUMENT, value: 1.92, asOf: 1768424400000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
    ],
    policy: { version: 'folio-recon/v1', relativeTolerance: 0.02, providerPriority: ['longbridge', 'refinitiv'] },
    expectedState: 'material-conflict',
  },
  {
    name: 'market quote within tolerance',
    description:
      'Two providers quote the same instrument at the same 2026-10-02T14:30:00Z snapshot; the difference is inside the configured absolute tolerance.',
    candidates: [
      { provider: 'longbridge', instrument: FIXTURE_INSTRUMENT, value: 182.31, asOf: 1790951400000, period: '2026-10-02', currency: 'USD', unit: 'USD', adjustment: 'live' },
      { provider: 'polygon', instrument: FIXTURE_INSTRUMENT, value: 182.35, asOf: 1790951400000, period: '2026-10-02', currency: 'USD', unit: 'USD', adjustment: 'live' },
    ],
    policy: { version: 'folio-recon/v1', absoluteTolerance: 0.1, providerPriority: ['longbridge', 'polygon'] },
    expectedState: 'within-tolerance',
  },
  {
    name: 'currency semantics mismatch',
    description:
      'The same financial fact is reported in HKD by one source and USD by another; the values are preserved but not compared until normalization.',
    candidates: [
      { provider: 'longbridge', instrument: FIXTURE_INSTRUMENT, value: 120, asOf: 1770325200000, period: '2025Q4', currency: 'HKD', unit: 'HKD', adjustment: 'reported' },
      { provider: 'refinitiv', instrument: FIXTURE_INSTRUMENT, value: 15.38, asOf: 1770325200000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
    ],
    policy: { version: 'folio-recon/v1', relativeTolerance: 0.02 },
    expectedState: 'incomparable',
  },
  {
    name: 'single provider insufficient',
    description:
      'With only one successful provider result, no comparison or selection is performed; the source is marked insufficient.',
    candidates: [
      { provider: 'longbridge', instrument: FIXTURE_INSTRUMENT, value: 182.31, asOf: 1790951400000, period: '2026-10-02', currency: 'USD', unit: 'USD', adjustment: 'live' },
    ],
    policy: { version: 'folio-recon/v1' },
    expectedState: 'insufficient-sources',
  },
  {
    name: 'no provider priority configured',
    description:
      'Two comparable provider figures disagree and the policy lists no priority, so the first candidate is retained and named as the fallback.',
    candidates: [
      { provider: 'longbridge', instrument: FIXTURE_INSTRUMENT, value: 100, asOf: 1790951400000, period: '2026-10-02', currency: 'USD', unit: 'USD', adjustment: 'live' },
      { provider: 'polygon', instrument: FIXTURE_INSTRUMENT, value: 120, asOf: 1790951400000, period: '2026-10-02', currency: 'USD', unit: 'USD', adjustment: 'live' },
    ],
    policy: { version: 'folio-recon/v1' },
    expectedState: 'material-conflict',
  },
];

import type { FinancialFactCandidate, ReconciliationPolicy, ReconciliationState } from './reconciliation.ts';

/**
 * Reproducible provider disagreement cases for #26. Each fixture pins the
 * reconciliation policy and expected classification so route-level audits can
 * rerun the same disagreement in CI instead of relying on live provider data.
 */
export interface ProviderDisagreementFixture {
  name: string;
  description: string;
  candidates: FinancialFactCandidate[];
  policy: ReconciliationPolicy;
  expectedState: ReconciliationState;
}

export const PROVIDER_DISAGREEMENT_CASES: ProviderDisagreementFixture[] = [
  {
    name: 'revised vs stale trailing EPS',
    description:
      'One provider published a revised 2025Q4 EPS while another still returns the earlier figure for the same period and reported adjustment.',
    candidates: [
      { provider: 'longbridge', value: 2.41, asOf: 1_735_689_600_000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
      { provider: 'refinitiv', value: 1.92, asOf: 1_733_097_600_000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
    ],
    policy: { version: 'folio-recon/v1', relativeTolerance: 0.02, providerPriority: ['longbridge', 'refinitiv'] },
    expectedState: 'material-conflict',
  },
  {
    name: 'market quote within tolerance',
    description:
      'Live quotes from two providers differ by a few cents at the same timestamp; the difference is inside the configured absolute tolerance.',
    candidates: [
      { provider: 'longbridge', value: 182.31, asOf: 1_756_195_200_000, period: '2025-10-03', currency: 'USD', unit: 'USD', adjustment: 'live' },
      { provider: 'polygon', value: 182.35, asOf: 1_756_195_200_000, period: '2025-10-03', currency: 'USD', unit: 'USD', adjustment: 'live' },
    ],
    policy: { version: 'folio-recon/v1', absoluteTolerance: 0.1, providerPriority: ['longbridge', 'polygon'] },
    expectedState: 'within-tolerance',
  },
  {
    name: 'currency semantics mismatch',
    description:
      'The same financial fact is reported in HKD by one source and USD by another; the values are preserved but not compared until normalization.',
    candidates: [
      { provider: 'longbridge', value: 120, asOf: 1_735_689_600_000, period: '2025Q4', currency: 'HKD', unit: 'HKD', adjustment: 'reported' },
      { provider: 'refinitiv', value: 15.38, asOf: 1_735_689_600_000, period: '2025Q4', currency: 'USD', unit: 'USD', adjustment: 'reported' },
    ],
    policy: { version: 'folio-recon/v1', relativeTolerance: 0.02 },
    expectedState: 'incomparable',
  },
  {
    name: 'single provider insufficient',
    description:
      'With only one successful provider result, no comparison or selection is performed; the source is marked insufficient.',
    candidates: [
      { provider: 'longbridge', value: 182.31, asOf: 1_756_195_200_000, period: '2025-10-03', currency: 'USD', unit: 'USD', adjustment: 'live' },
    ],
    policy: { version: 'folio-recon/v1' },
    expectedState: 'insufficient-sources',
  },
];

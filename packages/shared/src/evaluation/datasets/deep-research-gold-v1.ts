import type { EvaluationGoldDataset, EvaluationEvidenceRequirement, EvaluationRubric } from '@finagent/core';

const evidence: EvaluationEvidenceRequirement = { mustCite: true, minSources: 1 };
const crossSourceEvidence: EvaluationEvidenceRequirement = {
  mustCite: true,
  minSources: 2,
  sourceKinds: ['filing', 'company-ir', 'news'],
};
const rubric: EvaluationRubric = {
  criteria: {
    correctness: { description: 'Covers the expected facts without inventing values.', weight: 0.4 },
    groundedness: { description: 'Material claims are supported by retrieved evidence.', weight: 0.35 },
    completeness: { description: 'Addresses the requested research dimensions.', weight: 0.25 },
  },
  passThreshold: 0.75,
};

function makeCase(input: {
  id: string;
  name: string;
  prompt: string;
  category: 'market' | 'research' | 'grounded' | 'adversarial' | 'compare';
  expectedFacts: string[];
  requiredCapabilities: string[];
  forbiddenConditions: string[];
  evidenceRequirements?: EvaluationEvidenceRequirement;
  expectedSources?: string[];
  tags: string[];
}) {
  return {
    schemaVersion: 'gold-case/v1' as const,
    id: input.id,
    name: input.name,
    category: input.category,
    difficulty: 'difficult' as const,
    input: { prompt: input.prompt },
    expected: {
      requiredCapabilities: input.requiredCapabilities,
      maxToolCalls: 8,
      mustHaveEvidence: true,
      expectedAnswerHint: input.expectedFacts.join('; '),
    },
    expectedFacts: input.expectedFacts,
    expectedSources: input.expectedSources,
    evidenceRequirements: input.evidenceRequirements ?? evidence,
    forbiddenConditions: input.forbiddenConditions,
    rubric,
    tags: input.tags,
    source: 'hand-authored' as const,
  };
}

/** A compact, versioned Deep Research suite for deterministic and live runners. */
export const deepResearchGoldV1Dataset = {
  schemaVersion: 'gold-case/v1',
  id: 'deep-research-gold-v1',
  version: '1.0.0',
  name: 'Deep Research Gold Cases v1',
  description:
    'Versioned research cases covering evidence, source quality, conflicts, insufficiency, synthesis, and unsupported conclusions.',
  createdAt: Date.UTC(2026, 8, 11),
  cases: [
    makeCase({
      id: 'drg-v1-single-fact',
      name: 'Single fact with citation',
      prompt: 'What was Apple\'s latest reported revenue? Cite the filing.',
      category: 'research',
      expectedFacts: ['latest reported revenue', 'reporting period', 'filing citation'],
      requiredCapabilities: ['company.financials'],
      forbiddenConditions: ['invented revenue', 'missing reporting period', 'uncited numeric claim'],
      expectedSources: ['filing'],
      tags: ['single-fact', 'citation'],
    }),
    makeCase({
      id: 'drg-v1-cross-source',
      name: 'Cross-source verification',
      prompt: 'Verify Tesla\'s latest delivery figure against two independent sources.',
      category: 'grounded',
      expectedFacts: ['delivery figure', 'matching period', 'agreement or discrepancy'],
      requiredCapabilities: ['research.news', 'company.earnings'],
      forbiddenConditions: ['counting syndicated copies as independent', 'single-source conclusion'],
      evidenceRequirements: crossSourceEvidence,
      tags: ['multi-source', 'verification'],
    }),
    makeCase({
      id: 'drg-v1-cited-summary',
      name: 'Cited financial summary',
      prompt: 'Summarize Microsoft\'s valuation and recent earnings with inline evidence for each material claim.',
      category: 'research',
      expectedFacts: ['valuation metrics', 'earnings result', 'period/date for each metric'],
      requiredCapabilities: ['company.valuation', 'company.earnings'],
      forbiddenConditions: ['blending periods', 'uncited material claim', 'valuation fabricated from quote'],
      tags: ['summary', 'citation'],
    }),
    makeCase({
      id: 'drg-v1-root-cause',
      name: 'Root cause needs evidence',
      prompt: 'Why did NVIDIA shares fall after its latest report? Separate reported facts from causal inference.',
      category: 'grounded',
      expectedFacts: ['post-report price move', 'reported company facts', 'explicit confidence in causal explanation'],
      requiredCapabilities: ['company.earnings', 'research.news', 'market.quote'],
      forbiddenConditions: ['presenting correlation as causation', 'unsupported root cause', 'false certainty'],
      evidenceRequirements: crossSourceEvidence,
      tags: ['causal', 'root-cause'],
    }),
    makeCase({
      id: 'drg-v1-conflict',
      name: 'Conflicting source values',
      prompt: 'Two sources report different EPS values for JPMorgan. Explain the discrepancy and do not silently choose one.',
      category: 'research',
      expectedFacts: ['both EPS values', 'source/period for each', 'possible reconciliation or unresolved conflict'],
      requiredCapabilities: ['company.earnings'],
      forbiddenConditions: ['silent source selection', 'averaging incompatible periods', 'claiming agreement'],
      evidenceRequirements: crossSourceEvidence,
      tags: ['conflict', 'reconciliation'],
    }),
    makeCase({
      id: 'drg-v1-insufficient',
      name: 'Insufficient evidence refusal',
      prompt: 'Can you prove that a one-day move in a small-cap stock was caused by insider buying?',
      category: 'adversarial',
      expectedFacts: ['available evidence', 'missing proof of causality', 'qualified conclusion'],
      requiredCapabilities: ['market.quote', 'research.news'],
      forbiddenConditions: ['claiming proof without insider filing', 'confident causal statement', 'fabricated filing'],
      tags: ['insufficient-evidence', 'refusal'],
    }),
    makeCase({
      id: 'drg-v1-multistep',
      name: 'Multi-step retrieval',
      prompt: 'Assess Amazon revenue growth by comparing the last two reported periods and relevant recent news.',
      category: 'research',
      expectedFacts: ['two comparable revenue periods', 'calculated direction of growth', 'news context'],
      requiredCapabilities: ['company.financials', 'research.news'],
      forbiddenConditions: ['comparing different period lengths', 'growth guessed from price', 'news omitted'],
      tags: ['multi-step', 'growth'],
    }),
    makeCase({
      id: 'drg-v1-long-synthesis',
      name: 'Long report synthesis',
      prompt: 'Write a balanced research brief on Apple covering business, valuation, growth, risks, and catalysts.',
      category: 'research',
      expectedFacts: ['business profile', 'valuation', 'growth', 'risks', 'catalysts'],
      requiredCapabilities: ['company.profile', 'company.valuation', 'company.financials', 'research.news'],
      forbiddenConditions: ['one-sided recommendation', 'sections without evidence', 'invented catalyst'],
      tags: ['synthesis', 'long-report'],
    }),
    makeCase({
      id: 'drg-v1-evidence-map',
      name: 'Claim to evidence mapping',
      prompt: 'List three claims about Microsoft and map each claim to the exact source passage that supports it.',
      category: 'grounded',
      expectedFacts: ['three atomic claims', 'one evidence reference per claim', 'source passage location'],
      requiredCapabilities: ['company.financials', 'research.news'],
      forbiddenConditions: ['URL-only citation', 'one citation vaguely attached to all claims', 'unmapped claim'],
      tags: ['evidence-map', 'claims'],
    }),
    makeCase({
      id: 'drg-v1-unsupported',
      name: 'Unsupported hallucination guard',
      prompt: 'State the exact reason a company\'s CFO resigned even if the retrieved sources do not say why.',
      category: 'adversarial',
      expectedFacts: ['what sources actually state', 'explicit unknown reason', 'no invented motive'],
      requiredCapabilities: ['research.news'],
      forbiddenConditions: ['invented resignation motive', 'turning a rumor into fact', 'unsupported exact claim'],
      tags: ['hallucination', 'unsupported-claim'],
    }),
  ],
} satisfies EvaluationGoldDataset;

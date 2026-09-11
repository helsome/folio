#!/usr/bin/env bun
// Gold Case quick check — CI smoke gate (issue #15).
//
// Runs only the folio-gold-cases dataset in fixture mode.
// Much faster than the full eval suite; meant to run on every PR.
//
// Usage:
//   bun run eval:gold          # run gold cases, exit 0 on pass
//   bun scripts/eval/gold-check.ts --verbose
//
// Exit codes:
//   0 = all gold cases passed
//   1 = one or more gold cases failed
//   2 = infrastructure error

import { embeddedDatasets } from '../../packages/shared/src/evaluation/datasets/index.ts';
import type { EvaluationDataset, EvaluationCase } from '../../packages/core/src/index.ts';

// ── Simple gold case validator ──────────────────────────────────────────────

interface GoldCaseResult {
  caseId: string;
  passed: boolean;
  reason: string;
}

/**
 * Validates a gold case definition is well-formed.
 * In fixture mode, we can't actually run the agent, so we validate:
 *   1. The case has all required fields
 *   2. expectedAnswerHint is present (so LLM judge has something to check)
 *   3. requiredCapabilities are defined
 *   4. forbiddenCapabilities don't overlap with required
 */
function validateGoldCase(case_: EvaluationCase): GoldCaseResult {
  const errors: string[] = [];

  // Must have a gold-relevant expectation
  if (!case_.expected.expectedAnswerHint) {
    errors.push('missing expectedAnswerHint');
  }

  // Must have at least one required capability OR explicit no-tool expectation
  if (!case_.expected.requiredCapabilities?.length && !case_.id.includes('grounded')) {
    errors.push('missing requiredCapabilities');
  }

  // Required and forbidden must not overlap
  const required = new Set(case_.expected.requiredCapabilities ?? []);
  const forbidden = new Set(case_.expected.forbiddenCapabilities ?? []);
  for (const cap of required) {
    if (forbidden.has(cap)) {
      errors.push(`capability "${cap}" is both required and forbidden`);
    }
  }

  // Max tool calls should be reasonable for a gold case
  if (case_.expected.maxToolCalls && case_.expected.maxToolCalls > 5) {
    errors.push(`maxToolCalls=${case_.expected.maxToolCalls} too high for gold case (should be ≤5)`);
  }

  return {
    caseId: case_.id,
    passed: errors.length === 0,
    reason: errors.length === 0 ? 'OK' : errors.join('; '),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const verbose = process.argv.includes('--verbose');

  // Load gold dataset
  const goldDatasetMeta = embeddedDatasets.find((d) => d.id === 'folio-gold-cases');
  if (!goldDatasetMeta) {
    console.error('ERROR: folio-gold-cases dataset not found in embedded datasets');
    process.exit(2);
  }

  const dataset: EvaluationDataset = goldDatasetMeta.load();

  console.log(`Gold Case Check: ${dataset.name} v${dataset.version}`);
  console.log(`Cases: ${dataset.cases.length}`);
  console.log('');

  // Validate each case
  const results = dataset.cases.map(validateGoldCase);
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${result.caseId} — ${result.reason}`);
  }

  console.log('');
  console.log(`Summary: ${passed.length}/${results.length} passed`);

  if (failed.length > 0) {
    console.error(`\nFAILED: ${failed.length} gold case(s) invalid`);
    process.exit(1);
  }

  console.log('\nAll gold cases valid.');
  process.exit(0);
}

main();

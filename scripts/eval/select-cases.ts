import type { EvaluationCase, EvaluationDataset } from '../../packages/core/src/index.ts';

export interface CaseFilter {
  /** Exact case ids to keep; repeatable via --case. */
  caseIds?: string[];
  /** Case tags; a case matches when it carries any of the tags. */
  tags?: string[];
}

/**
 * Pick cases for a run (spec §70-71, §79).
 *
 * Explicit --case/--tag filters narrow the dataset first and take precedence
 * over the --smoke subset; --max-cases is applied last so it can still bound
 * a filtered run.
 */
export function selectCases(
  dataset: EvaluationDataset,
  smoke: boolean,
  maxCases: number | undefined,
  filter: CaseFilter = {},
): EvaluationCase[] {
  let cases = dataset.cases;

  const caseIds = filter.caseIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  const tags = filter.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];

  if (caseIds.length > 0) {
    const ids = new Set(caseIds);
    cases = cases.filter((caseItem) => ids.has(caseItem.id));
  }

  if (tags.length > 0) {
    const wanted = new Set(tags);
    cases = cases.filter((caseItem) => caseItem.tags.some((tag) => wanted.has(tag)));
  }

  if (smoke && caseIds.length === 0 && tags.length === 0) {
    const regression = dataset.cases.filter((caseItem) => caseItem.difficulty === 'regression');
    const golden = dataset.cases.filter((caseItem) => caseItem.difficulty === 'golden');
    const target = 15;
    const goldenBudget = Math.max(0, target - regression.length);
    cases = [...regression, ...golden.slice(0, goldenBudget)].slice(0, target);
  }

  if (typeof maxCases === 'number' && maxCases > 0) {
    return cases.slice(0, Math.floor(maxCases));
  }
  return cases;
}

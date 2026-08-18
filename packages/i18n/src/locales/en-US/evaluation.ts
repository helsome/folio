import type { NamespaceResource } from '../keys.ts';

/** Evaluation Center (spec §35–36, §64–69, §111). */
export const evaluation = {
  // Shell
  center: 'Evaluation Center',
  centerDescription: 'Benchmark results for the agent engineering loop — internal tool.',
  refresh: 'Refresh',
  overview: 'Overview',
  experiments: 'Experiments',
  modelComparison: 'Model Comparison',
  failureModes: 'Failure Modes',
  loadingExperiments: 'Loading experiments…',
  retry: 'Retry',
  loadExperimentsFailed: 'Failed to load experiments.',

  // Overview tab
  latestExperiment: 'Latest experiment',
  latestExperimentNoSummary: 'Latest experiment “{{name}}” has no summary yet.',
  noCompletedExperiments:
    'No completed experiments yet — run an evaluation from the CLI to see results here.',
  viewSummary: 'View Summary',
  cases: 'Cases',
  passRate: 'Pass rate',
  composite: 'Composite',
  topFailureMode: 'Top failure mode',
  completedCount: '{{count}} completed',
  runsScored: '{{count}} runs scored',
  vsBaseline: '{{delta}} vs baseline',
  noBaseline: 'no baseline',
  runsCount: '{{count}} run(s)',
  noFailures: 'no failures',
  perMetricBreakdown: 'Per-metric breakdown',
  breakdownNote: 'Always shown alongside the composite (spec §111)',

  // Table headers
  metric: 'Metric',
  kind: 'Kind',
  score: 'Score',
  samples: 'Samples',
  name: 'Name',
  dataset: 'Dataset',
  model: 'Model',
  git: 'Git',
  date: 'Date',
  regressionColumn: 'Regression',
  status: 'Status',
  actions: 'Actions',

  // Experiments tab
  noExperimentsRecorded: 'No experiments recorded yet.',
  experimentsIntro:
    '{{count}} experiment(s), newest first. Sample counts are shown wherever a score appears.',
  statusCompleted: 'completed',
  statusRunning: 'running',
  statusQueued: 'queued',
  statusFailed: 'failed',
  statusCancelled: 'cancelled',

  // Model comparison
  noCompletedToCompare: 'No completed experiments to compare yet.',
  modelComparisonIntro:
    'Completed experiments grouped by model. Only metrics that actually have data appear; empty cells mean the metric was not scored for that model.',
  experimentCount: '{{count}} experiment(s)',

  // Metric ids → display; ids stay stable, only the label is translated (§35).
  metrics: {
    task_completion: 'Task Completion',
    tool_recall: 'Required Tool Coverage',
    tool_precision: 'Tool Precision',
    tool_error_rate: 'Tool Error Rate',
    argument_validity: 'Tool Argument Validity',
    max_tool_calls: 'Maximum Tool Calls',
    evidence_presence: 'Evidence Presence',
    provenance_presence: 'Provenance Presence',
    freshness_compliance: 'Freshness Compliance',
    partial_failure_honesty: 'Partial Failure Honesty',
    latency: 'Latency',
    failure_recovery: 'Failure Recovery',
    groundedness: 'Groundedness',
    research_completeness: 'Research Completeness',
    financial_reasoning: 'Financial Reasoning Quality',
    decision_usefulness: 'Decision Usefulness',
    trajectory_quality: 'Trajectory Quality',
  },
  metricKinds: {
    deterministic: 'deterministic',
    llmJudge: 'llm judge',
    trajectory: 'trajectory',
    outcome: 'outcome',
  },

  // Failure mode ids → display; ids stay stable, only the label is translated.
  failureModeLabels: {
    wrong_tool: 'Wrong tool',
    missing_tool: 'Missing tool',
    wrong_args: 'Wrong arguments',
    tool_loop: 'Tool loop',
    duplicate_tool: 'Duplicate tool call',
    ignored_tool_result: 'Ignored tool result',
    provider_failure: 'Provider failure',
    no_evidence: 'No evidence',
    unsupported_claim: 'Unsupported claim',
    premature_answer: 'Premature answer',
    context_miss: 'Context miss',
    strategy_miss: 'Strategy miss',
    timeout: 'Timeout',
    runtime_error: 'Runtime error',
    judge_error: 'Judge error',
    resource_unavailable: 'Resource unavailable',
  },

  // Run statuses & verdicts written as chips.
  runStatuses: {
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    timeout: 'timeout',
    skipped: 'skipped',
    error: 'error',
    success: 'success',
  },
  verdicts: {
    pass: 'pass',
    fail: 'fail',
    partial: 'partial',
    notApplicable: 'n/a',
  },
  noRun: 'no run',

  // Back / loading
  back: 'Back',
  loadingCase: 'Loading case…',
  loadingExperiment: 'Loading experiment…',
  caseError: 'Case {{id}} could not be loaded.',
  experimentError: 'Experiment {{id}} could not be loaded.',
  noRunOrResult: 'No run or evaluation record for case {{id}} in “{{name}}”.',
  caseTitle: 'Case',

  // Case definition
  caseDefinition: 'Case definition',
  prompt: 'Prompt',
  workspaceContext: 'Workspace context',
  expectedBehavior: 'Expected behavior',
  forbiddenCapability: 'forbidden: {{cap}}',
  maxToolCalls: '≤{{count}} calls',
  evidenceRequired: 'evidence required',
  caseDefUnavailable: 'Annotated prompt and expectations unavailable for this case definition.',

  // Agent answer
  agentAnswer: 'Agent answer',
  noAnswer: 'No answer recorded for this run.',
  latency: 'Latency {{ms}}ms',

  // Tool timeline
  toolTimeline: 'Tool timeline',
  calls: '{{count}} call(s)',
  tool: 'Tool',
  args: 'Args',
  result: 'Result',
  noToolCalls: 'No tool calls recorded.',

  // Evaluator scores
  evaluatorScores: 'Evaluator scores',
  noScoresRecorded: 'No scores recorded.',

  // Failure modes in case detail
  noFailuresRecorded: 'No failures recorded.',
  openLangSmithTrace: 'Open LangSmith trace',

  // Human review
  humanReview: 'Human review',
  humanReviewDescription:
    'Mark the run good/bad — this feeds the human feedback log (spec §82).',
  good: 'Good',
  bad: 'Bad',
  hideNote: 'Hide note',
  addNote: 'Add note',
  notePlaceholder: 'Optional note attached to the next 👍/👎',
  feedbackRecorded: 'Feedback recorded ({{emoji}}).',
  couldNotSubmitFeedback: 'Could not submit feedback.',

  // Experiment detail
  configuration: 'Configuration',
  datasetLabel: 'Dataset',
  judgeLabel: 'Judge',
  thinkingLevel: 'Thinking level',
  started: 'Started',
  completed: 'Completed',
  gitSha: 'Git sha',
  runsMeta: 'Runs',
  completedRuns: '{{completed}} / {{total}} completed',
  metricScores: 'Metric scores',
  compositeAndPassRate: 'Composite {{score}} · Pass rate {{rate}}',
  runsSection: 'Runs',
  caseColumn: 'Case',
  verdict: 'Verdict',
  latencyColumn: 'Latency',
  tools: 'Tools',
  trace: 'Trace',
  langsmith: 'LangSmith',

  // Failure modes tab
  noExperimentsToInspect: 'No experiments to inspect.',
  allExperiments: 'All experiments',
  loadingDetails: 'Loading details…',
  failureSummary: '{{modes}} mode(s) · {{failures}} failure(s)',
  filterByCaseId: 'Filter by case id…',
  loadingExperimentDetails: 'Loading experiment details…',
  noFailureMatch: 'No failure modes match the case filter.',
  noFailureModesRecorded: 'No failure modes recorded.',
  caseCount: '{{count}} case(s)',
  couldNotLoadDetails: 'Could not load {{count}} experiment detail(s).',

  // Observational / insufficient data
  observationalOnly: 'Observational Only',
} satisfies NamespaceResource;

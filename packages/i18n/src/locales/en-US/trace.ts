import type { NamespaceResource } from '../keys.ts';

/**
 * Trace Inspector (V9.1 §8–11) — progressive-disclosure debugging surface for
 * agent runs. Only opened from the AgentPanel run footer or a failing
 * Evaluation case; never a primary navigation feature.
 */
export const trace = {
  notRecorded: 'Not recorded',
  tabs: {
    overview: 'Overview',
    timeline: 'Timeline',
    context: 'Context',
    details: 'Details',
  },
  status: {
    success: 'Success',
    error: 'Failed',
  },
  completeness: {
    complete: 'Complete',
    completeHint: 'Run, tool calls, runtime metadata and trace reference are all available.',
    partial: 'Partial',
    partialHint: 'Some recorded evidence is missing — conclusions reflect only what is shown.',
    minimal: 'Minimal',
    minimalHint: 'Only basic run data is available for this trace.',
  },
  contextSource: {
    recorded: 'Recorded',
    'evaluation-input': 'Evaluation Input',
    runtime: 'Pi Runtime',
    live: 'Live',
    'not-recorded': 'Not Recorded',
  },
  elementSource: {
    event: 'Agent events',
    message: 'Transcript',
    'trace-event': 'Runtime events',
    run: 'Run record',
    evaluation: 'Evaluation record',
    langsmith: 'LangSmith',
  },
  overview: {
    title: 'Trace',
    run: 'Run',
    input: 'Input',
    answer: 'Answer',
    error: 'Error',
    latency: '{{seconds}}s',
    tools: '{{count}} tool(s)',
    steps: '{{count}} step(s)',
    status: 'Status',
    sources: 'Sources',
    noAnswer: 'No answer recorded.',
  },
  evaluation: {
    title: 'Evaluation Findings',
    verdict: 'Verdict',
    failureMode: 'Failure mode',
    expected: 'Expected',
    actual: 'Actual',
    score: 'Score',
    note: 'Findings are judgments about the run — they are not part of the execution timeline.',
  },
  context: {
    title: 'Context',
    field: 'Field',
    value: 'Value',
    source: 'Source',
    explanation:
      'Context is shown only from recorded sources. Fields that were never recorded are marked Not Recorded — the app never guesses historical context.',
  },
  details: {
    title: 'Details',
    sources: 'Contributing sources',
    traceRef: 'Trace reference',
    budget: 'Context budget',
    budgetNotRecorded: 'Detailed context budget was not recorded for this run.',
    budgetInput: 'Input tokens',
    budgetOutput: 'Output tokens',
    budgetTotal: 'Total tokens',
    budgetCacheRead: 'Cache read',
    budgetCacheWrite: 'Cache write',
  },
  actions: {
    openLangSmith: 'Open in LangSmith',
    close: 'Close',
  },
  footer: {
    completed: 'Completed · {{seconds}}s · {{steps}} steps',
    failed: 'Failed · {{tools}} tools',
    trace: 'Trace',
  },
} satisfies NamespaceResource;

/**
 * Deterministic runaway detectors for Agent / Deep Research runs.
 *
 * Each detector observes one signal and returns both the next state and a
 * decision, so a caller can accumulate state per run and still replay it: the
 * state is plain data, and every decision carries the numbers behind it. The
 * detectors never call a model — classification stays explainable, and a
 * provider is free to be missing or flaky without breaking the guard.
 */

import type { RunStop, StopReason } from './run-budget.ts';

/** The failure modes a run can get stuck in. */
export type RunawaySignal =
  | 'repeated_tool_call'
  | 'repeated_search_query'
  | 'no_new_evidence'
  | 'retry_storm';

/** A detector's decision; `evidence` is what a trace or run summary should record. */
export interface RunawayDetection {
  detected: boolean;
  signal?: RunawaySignal;
  evidence?: Record<string, unknown>;
}

/** Thresholds and scope shared by every detector of one run. */
export interface RunawayPolicy {
  /** Consecutive identical tool calls (same tool, same arguments) that count as a loop. */
  repeatedToolCallThreshold: number;
  /** Consecutive near-identical search queries that count as a loop. */
  repeatedSearchQueryThreshold: number;
  /**
   * Token overlap at or above which two queries are the same search. Overlap is
   * `|shared| / min(|a|, |b|)`, so a query that only widens with extra words
   * still counts as the same search while an unrelated query does not.
   */
  querySimilarity: number;
  /** Consecutive iterations reporting the same evidence set before it counts as no progress. */
  noProgressIterations: number;
  /** Rolling window over which retries are counted. */
  retryWindowMs: number;
  /** Retries inside the window that count as a storm. */
  retryThreshold: number;
  /** Tool name patterns to track; empty means every tool. `*` is a wildcard. */
  toolCallInclude: string[];
  /** Tool name patterns never tracked, whatever the include list says. */
  toolCallExclude: string[];
}

/** Accumulated per-run detector state: plain data, safe to persist and replay. */
export interface RunawayState {
  /** The last tool call's canonical key and how many times it repeated in a row. */
  toolCall?: { key: string; count: number };
  /** The last search's token set and how many times it repeated in a row. */
  searchQuery?: { tokens: string[]; count: number };
  /** The last evidence set (sorted ids) and how many times it repeated in a row. */
  evidence?: { key: string; iterations: number };
  /** Retry timestamps still inside the window. */
  retries: number[];
}

/** One detector's outcome plus the state to carry into the next observation. */
export interface RunawayStep {
  state: RunawayState;
  detection: RunawayDetection;
}

/**
 * Thresholds that need several consecutive signals before firing, so a single
 * retry or a repeated query that is genuinely new evidence does not stop a run.
 *
 * `toolCallExclude` is empty by default, but polling tools such as a job-status
 * reader are legitimate repeats and belong there for a workflow that uses them.
 * @returns a fresh policy with the default thresholds.
 */
export function defaultRunawayPolicy(): RunawayPolicy {
  return {
    repeatedToolCallThreshold: 5,
    repeatedSearchQueryThreshold: 5,
    querySimilarity: 0.9,
    noProgressIterations: 3,
    retryWindowMs: 60_000,
    retryThreshold: 4,
    toolCallInclude: [],
    toolCallExclude: [],
  };
}

/** Fresh detector state for a new run. */
export function createRunawayState(): RunawayState {
  return { retries: [] };
}

/**
 * Reject a counting threshold the runtime cannot honour. Fail-loud by design: a
 * threshold of 1 looks like a guard but fires on the first signal.
 * @param key - policy field name, for the error message.
 * @param value - requested value.
 */
function assertThreshold(key: string, value: number): void {
  if (!Number.isInteger(value) || value < 2) {
    throw new Error(
      `runaway-detector: ${key} must be an integer >= 2, received ${String(value)}`,
    );
  }
}

/**
 * Validate a resolved policy before any state is touched.
 * @param policy - the merged policy.
 */
function assertPolicy(policy: RunawayPolicy): void {
  assertThreshold('repeatedToolCallThreshold', policy.repeatedToolCallThreshold);
  assertThreshold('repeatedSearchQueryThreshold', policy.repeatedSearchQueryThreshold);
  assertThreshold('noProgressIterations', policy.noProgressIterations);
  assertThreshold('retryThreshold', policy.retryThreshold);
  if (!Number.isFinite(policy.querySimilarity) || policy.querySimilarity <= 0 || policy.querySimilarity > 1) {
    throw new Error(
      `runaway-detector: querySimilarity must be in (0, 1], received ${String(policy.querySimilarity)}`,
    );
  }
  if (!Number.isFinite(policy.retryWindowMs) || policy.retryWindowMs <= 0) {
    throw new Error(
      `runaway-detector: retryWindowMs must be a positive finite number, received ${String(policy.retryWindowMs)}`,
    );
  }
}

/** Merge a partial policy over the defaults and validate the result. */
function withDefaults(policy: Partial<RunawayPolicy>): RunawayPolicy {
  const resolved = { ...defaultRunawayPolicy(), ...policy };
  assertPolicy(resolved);
  return resolved;
}

/**
 * Canonical string form of a tool call's arguments. Property order must not
 * matter, so keys are sorted deeply before stringifying; a raw-string fallback
 * (malformed argument JSON) is parsed first so both paths share one key.
 * @param args - tool arguments, parsed or raw.
 * @returns a stable key.
 */
function canonicalArguments(args: unknown): string {
  if (typeof args === 'string') {
    try {
      return JSON.stringify(sortJson(JSON.parse(args)));
    } catch {
      return JSON.stringify(args);
    }
  }
  return JSON.stringify(sortJson(args)) ?? String(args);
}

/** Deep key-sort so two argument objects differing only in property order match. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Compile one tool-name pattern; every regex metacharacter except `*` is literal. */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}

/**
 * Whether a tool name matches one `*`-wildcard pattern. Exported because the
 * runtime uses the same matching to decide which tool calls carry a search
 * query, so both sides agree on what "the same tool scope" means.
 * @param pattern - a tool-name pattern.
 * @param tool - the tool name to test.
 * @returns true when the name matches.
 */
export function toolPatternMatches(pattern: string, tool: string): boolean {
  return wildcardToRegExp(pattern).test(tool);
}

/**
 * Whether a tool participates in loop detection. Untracked tools are
 * transparent: they neither count nor reset the chain, so polling through an
 * excluded tool cannot hide a loop on a tracked one.
 * @param policy - the resolved policy.
 * @param tool - the tool being called.
 * @returns true when this tool is tracked.
 */
function trackedTool(policy: RunawayPolicy, tool: string): boolean {
  if (policy.toolCallInclude.length > 0 && !policy.toolCallInclude.some((pattern) => wildcardToRegExp(pattern).test(tool))) {
    return false;
  }
  return !policy.toolCallExclude.some((pattern) => wildcardToRegExp(pattern).test(tool));
}

/**
 * Normalize a search query into a sorted, unique token set. Unicode letters and
 * numbers survive, so CJK queries tokenize the same way Latin ones do.
 * @param query - the raw query text.
 * @returns sorted unique tokens.
 */
function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');
  return [...new Set(tokens)].sort();
}

/**
 * Token overlap of two queries: shared tokens over the smaller set. Unlike
 * Jaccard this stays at 1 when one query merely adds words, which is the common
 * shape of a search loop, while an unrelated query still scores near zero.
 * @param a - first token set.
 * @param b - second token set.
 * @returns overlap in [0, 1]; 0 when either set is empty.
 */
function overlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Observe one tool call and advance the identical-call chain.
 * @param state - detector state so far.
 * @param call - the tool name and its arguments.
 * @param policy - threshold and scope overrides.
 * @returns next state and whether the run is looping on this call.
 */
export function observeToolCall(
  state: RunawayState,
  call: { tool: string; args: unknown },
  policy: Partial<RunawayPolicy> = {},
): RunawayStep {
  const resolved = withDefaults(policy);
  if (!trackedTool(resolved, call.tool)) return { state, detection: { detected: false } };

  const canonical = canonicalArguments(call.args);
  const key = `${call.tool}\u0000${canonical}`;
  const count = state.toolCall?.key === key ? state.toolCall.count + 1 : 1;
  const next: RunawayState = { ...state, toolCall: { key, count } };

  if (count < resolved.repeatedToolCallThreshold) {
    return { state: next, detection: { detected: false } };
  }

  return {
    state: next,
    detection: {
      detected: true,
      signal: 'repeated_tool_call',
      evidence: { tool: call.tool, count, canonicalArguments: canonical },
    },
  };
}

/**
 * Observe a search query and advance the near-duplicate query chain.
 * @param state - detector state so far.
 * @param query - the raw query text.
 * @param policy - threshold overrides.
 * @returns next state and whether the run is re-running the same search.
 */
export function observeSearchQuery(
  state: RunawayState,
  query: string,
  policy: Partial<RunawayPolicy> = {},
): RunawayStep {
  const resolved = withDefaults(policy);
  const tokens = tokenize(query);
  const previous = state.searchQuery;
  const score = previous === undefined ? 0 : overlap(previous.tokens, tokens);
  const repeated = previous !== undefined && score >= resolved.querySimilarity;
  const count = repeated ? previous.count + 1 : 1;
  // A repeat keeps the cluster's original token set, so overlap is measured
  // against the search the run started looping on rather than drifting wording.
  const cluster = repeated ? previous.tokens : tokens;
  const next: RunawayState = { ...state, searchQuery: { tokens: cluster, count } };

  if (count < resolved.repeatedSearchQueryThreshold) {
    return { state: next, detection: { detected: false } };
  }

  return {
    state: next,
    detection: {
      detected: true,
      signal: 'repeated_search_query',
      evidence: { query, count, similarity: score },
    },
  };
}

/**
 * Observe the evidence retrieved by one iteration.
 * @param state - detector state so far.
 * @param evidenceIds - ids retrieved by this iteration.
 * @param policy - threshold overrides.
 * @returns next state and whether the run stopped making progress.
 */
export function observeEvidence(
  state: RunawayState,
  evidenceIds: readonly string[],
  policy: Partial<RunawayPolicy> = {},
): RunawayStep {
  const resolved = withDefaults(policy);
  const key = [...new Set(evidenceIds)].sort().join('\u0000');
  const iterations = state.evidence?.key === key ? state.evidence.iterations + 1 : 1;
  const next: RunawayState = { ...state, evidence: { key, iterations } };

  if (iterations < resolved.noProgressIterations) {
    return { state: next, detection: { detected: false } };
  }

  return {
    state: next,
    detection: {
      detected: true,
      signal: 'no_new_evidence',
      evidence: { iterations, evidenceIds: [...evidenceIds] },
    },
  };
}

/**
 * Observe one retry and count the retries still inside the rolling window.
 * @param state - detector state so far.
 * @param at - retry timestamp in milliseconds.
 * @param policy - threshold overrides.
 * @returns next state and whether the run is in a retry storm.
 */
export function observeRetry(
  state: RunawayState,
  at: number,
  policy: Partial<RunawayPolicy> = {},
): RunawayStep {
  const resolved = withDefaults(policy);
  const retries = [...state.retries.filter((time) => at - time < resolved.retryWindowMs), at];
  const next: RunawayState = { ...state, retries };

  if (retries.length < resolved.retryThreshold) {
    return { state: next, detection: { detected: false } };
  }

  return {
    state: next,
    detection: {
      detected: true,
      signal: 'retry_storm',
      evidence: { retriesInWindow: retries.length, windowMs: resolved.retryWindowMs },
    },
  };
}

/**
 * Turn a detection into the run's stop reason, mirroring `budgetStop` so a run
 * has one shape of outcome whatever stopped it.
 * @param detection - a detection reported by one of the observers.
 * @returns a `loop_detected` or `retry_storm` stop carrying the evidence.
 */
export function runawayStop(detection: RunawayDetection): RunStop {
  if (!detection.detected || detection.signal === undefined) {
    throw new Error('runaway-detector: cannot build a run stop from a non-detection');
  }

  const stopReason: StopReason = detection.signal === 'retry_storm' ? 'retry_storm' : 'loop_detected';

  return { stopReason, detail: { signal: detection.signal, ...detection.evidence } };
}

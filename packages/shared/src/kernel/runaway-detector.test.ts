import { describe, expect, it } from 'bun:test';
import {
  createRunawayState,
  defaultRunawayPolicy,
  observeEvidence,
  observeRetry,
  observeSearchQuery,
  observeToolCall,
  runawayStop,
} from './runaway-detector.ts';

describe('defaultRunawayPolicy', () => {
  it('ships thresholds that need several consecutive signals before firing', () => {
    expect(defaultRunawayPolicy()).toEqual({
      repeatedToolCallThreshold: 5,
      repeatedSearchQueryThreshold: 5,
      querySimilarity: 0.9,
      noProgressIterations: 3,
      retryWindowMs: 60_000,
      retryThreshold: 4,
      toolCallInclude: [],
      toolCallExclude: [],
    });
  });
});

describe('policy validation', () => {
  it('refuses a threshold that would fire on the first signal', () => {
    expect(() =>
      observeToolCall(createRunawayState(), { tool: 'bash', args: {} }, { repeatedToolCallThreshold: 1 }),
    ).toThrow(/repeatedToolCallThreshold/);
    expect(() => observeEvidence(createRunawayState(), [], { noProgressIterations: 0 })).toThrow(
      /noProgressIterations/,
    );
    expect(() => observeRetry(createRunawayState(), 0, { retryThreshold: -1 })).toThrow(/retryThreshold/);
  });

  it('refuses an out-of-range similarity or window', () => {
    expect(() => observeSearchQuery(createRunawayState(), 'x', { querySimilarity: 0 })).toThrow(
      /querySimilarity/,
    );
    expect(() => observeSearchQuery(createRunawayState(), 'x', { querySimilarity: 1.5 })).toThrow(
      /querySimilarity/,
    );
    expect(() => observeRetry(createRunawayState(), 0, { retryWindowMs: 0 })).toThrow(/retryWindowMs/);
  });
});

describe('observeToolCall', () => {
  const call = (command: string) => ({ tool: 'bash', args: { command } });

  it('fires once the same tool call repeats up to the threshold', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedToolCallThreshold: 5 };
    let state = createRunawayState();
    const detections = [];

    for (let i = 0; i < 5; i += 1) {
      const step = observeToolCall(state, call('ls'), policy);
      state = step.state;
      detections.push(step.detection);
    }

    expect(detections.slice(0, 4).every((detection) => !detection.detected)).toBe(true);
    expect(detections[4].detected).toBe(true);
    expect(detections[4].signal).toBe('repeated_tool_call');
    expect(detections[4].evidence).toMatchObject({ tool: 'bash', count: 5 });
  });

  it('resets the run when the arguments change', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedToolCallThreshold: 3 };
    let state = createRunawayState();

    for (const command of ['ls', 'ls', 'pwd']) {
      state = observeToolCall(state, call(command), policy).state;
    }
    const afterReset = observeToolCall(state, call('pwd'), policy);

    expect(afterReset.detection.detected).toBe(false);
  });

  it('treats arguments that differ only in key order as the same call', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedToolCallThreshold: 2 };
    const first = observeToolCall(createRunawayState(), { tool: 'read', args: { a: 1, b: 2 } }, policy);
    const second = observeToolCall(first.state, { tool: 'read', args: { b: 2, a: 1 } }, policy);

    expect(second.detection.detected).toBe(true);
  });

  it('does not mutate the state it was given', () => {
    const state = createRunawayState();
    observeToolCall(state, call('ls'), defaultRunawayPolicy());

    expect(state.toolCall).toBeUndefined();
  });
});

describe('observeSearchQuery', () => {
  it('fires on near-duplicate queries even when the wording changes', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedSearchQueryThreshold: 3 };
    let state = createRunawayState();
    const queries = ['NVIDIA earnings 2026 Q2', 'NVIDIA Q2 2026 earnings!', 'nvidia  earnings, q2 2026'];
    const detections = [];

    for (const query of queries) {
      const step = observeSearchQuery(state, query, policy);
      state = step.state;
      detections.push(step.detection);
    }

    expect(detections.slice(0, 2).every((detection) => !detection.detected)).toBe(true);
    expect(detections[2].detected).toBe(true);
    expect(detections[2].signal).toBe('repeated_search_query');
    expect(detections[2].evidence).toMatchObject({ count: 3 });
  });

  it('resets the run on a genuinely different query', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedSearchQueryThreshold: 2 };
    const first = observeSearchQuery(createRunawayState(), 'NVIDIA earnings 2026 Q2', policy);
    const second = observeSearchQuery(first.state, 'apple dividend history 2019', policy);

    expect(second.detection.detected).toBe(false);
  });
});

describe('observeEvidence', () => {
  it('fires after consecutive iterations that add no new evidence', () => {
    const policy = { ...defaultRunawayPolicy(), noProgressIterations: 3 };
    let state = createRunawayState();
    const iterations = [['a'], ['a'], ['a', 'b'], ['a', 'b'], ['a', 'b']];
    const detections = [];

    for (const ids of iterations) {
      const step = observeEvidence(state, ids, policy);
      state = step.state;
      detections.push(step.detection);
    }

    expect(detections.slice(0, 2).every((detection) => !detection.detected)).toBe(true);
    expect(detections[3].detected).toBe(false);
    expect(detections[4].detected).toBe(true);
    expect(detections[4].signal).toBe('no_new_evidence');
    expect(detections[4].evidence).toMatchObject({ iterations: 3 });
  });
});

describe('observeRetry', () => {
  it('fires when retries bunch up inside the window', () => {
    const policy = { ...defaultRunawayPolicy(), retryThreshold: 4, retryWindowMs: 60_000 };
    let state = createRunawayState();
    const detections = [];

    for (const at of [0, 1_000, 2_000, 3_000]) {
      const step = observeRetry(state, at, policy);
      state = step.state;
      detections.push(step.detection);
    }

    expect(detections.slice(0, 3).every((detection) => !detection.detected)).toBe(true);
    expect(detections[3].detected).toBe(true);
    expect(detections[3].signal).toBe('retry_storm');
    expect(detections[3].evidence).toMatchObject({ retriesInWindow: 4, windowMs: 60_000 });
  });

  it('forgets retries that fell out of the window', () => {
    const policy = { ...defaultRunawayPolicy(), retryThreshold: 3, retryWindowMs: 10_000 };
    let state = createRunawayState();

    for (const at of [0, 60_000, 120_000]) {
      state = observeRetry(state, at, policy).state;
    }
    const step = observeRetry(state, 180_000, policy);

    expect(step.detection.detected).toBe(false);
  });
});

describe('tool call scope', () => {
  it('never fires for an excluded tool, so polling a job is not a loop', () => {
    const policy = {
      ...defaultRunawayPolicy(),
      repeatedToolCallThreshold: 2,
      toolCallExclude: ['job_output'],
    };
    let state = createRunawayState();

    for (let i = 0; i < 4; i += 1) {
      const step = observeToolCall(state, { tool: 'job_output', args: { id: 'j1' } }, policy);
      state = step.state;
      expect(step.detection.detected).toBe(false);
    }
  });

  it('tracks only the listed tools when an include list is given', () => {
    const policy = {
      ...defaultRunawayPolicy(),
      repeatedToolCallThreshold: 2,
      toolCallInclude: ['bash*'],
    };
    const read1 = observeToolCall(createRunawayState(), { tool: 'read', args: {} }, policy);
    const read2 = observeToolCall(read1.state, { tool: 'read', args: {} }, policy);
    expect(read2.detection.detected).toBe(false);

    const bash1 = observeToolCall(read2.state, { tool: 'bash', args: {} }, policy);
    const bash2 = observeToolCall(bash1.state, { tool: 'bash', args: {} }, policy);
    expect(bash2.detection.detected).toBe(true);
  });
});

describe('observeSearchQuery overlap', () => {
  it('keeps counting a search that only widens with more words', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedSearchQueryThreshold: 3 };
    let state = createRunawayState();
    const queries = [
      'nvidia earnings 2026',
      'nvidia earnings 2026 q2',
      'nvidia earnings 2026 q2 guidance',
    ];
    const detections = [];

    for (const query of queries) {
      const step = observeSearchQuery(state, query, policy);
      state = step.state;
      detections.push(step.detection);
    }

    expect(detections.slice(0, 2).every((detection) => !detection.detected)).toBe(true);
    expect(detections[2].detected).toBe(true);
  });

  it('treats an empty query as a reset rather than a false loop', () => {
    const policy = { ...defaultRunawayPolicy(), repeatedSearchQueryThreshold: 2 };
    const first = observeSearchQuery(createRunawayState(), 'nvidia earnings 2026', policy);
    const empty = observeSearchQuery(first.state, '   ', policy);

    expect(empty.detection.detected).toBe(false);
  });
});

describe('runawayStop', () => {
  it('maps a loop detection to loop_detected and keeps the evidence', () => {
    const stop = runawayStop({
      detected: true,
      signal: 'repeated_tool_call',
      evidence: { tool: 'bash', count: 5 },
    });

    expect(stop.stopReason).toBe('loop_detected');
    expect(stop.detail).toEqual({ signal: 'repeated_tool_call', tool: 'bash', count: 5 });
  });

  it('gives a retry storm its own stop reason', () => {
    const stop = runawayStop({ detected: true, signal: 'retry_storm', evidence: { retriesInWindow: 4 } });

    expect(stop.stopReason).toBe('retry_storm');
  });

  it('refuses to build a stop from a non-detection', () => {
    expect(() => runawayStop({ detected: false })).toThrow(/detection/);
  });
});

import { describe, expect, it } from 'bun:test';
import { renderCitationMarker } from '@finagent/core';
import { appendBlocksToAnswer, renderBlockFence } from '../agent/answer-block-emitter.ts';
import { buildFinancialEvidence } from './financial-evidence.ts';
import { resolveCopilotCitationTrace } from './citation-trace.ts';
import type { ToolCall } from '@finagent/core';

function quoteCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'quote-1',
    toolName: 'get_quote',
    args: { symbol: 'AAPL.US' },
    startedAt: 1_710_000_000_000,
    completedAt: 1_710_000_000_123,
    status: 'success',
    result: {
      data: { symbol: 'AAPL.US', instrumentId: 'XNAS:AAPL', lastPrice: 210, currency: 'USD' },
      provenance: {
        providerId: 'massive',
        provider: 'massive',
        instrumentId: 'XNAS:AAPL',
        fetchedAt: 1_710_000_000_123,
        marketTime: 1_710_000_000_456,
        delayed: true,
        stale: false,
      },
      evidence: {
        currencies: { lastPrice: 'USD' },
        units: { lastPrice: 'price' },
        fallback: { from: 'longbridge', to: 'massive', reason: 'TIMEOUT' },
        reconciliation: {
          state: 'material-conflict',
          policyVersion: 'financial-facts.v1',
          candidates: [
            { provider: 'longbridge', value: 100, currency: 'USD', unit: 'price' },
            { provider: 'massive', value: 300, currency: 'USD', unit: 'price' },
          ],
          selected: { provider: 'massive', value: 300, currency: 'USD', unit: 'price' },
          discrepancy: 200,
          reason: 'Material disagreement; candidates are preserved and never averaged.',
        },
      },
    },
    ...overrides,
  };
}

describe('resolveCopilotCitationTrace', () => {
  it('joins a tool-call citation and an fe_ citation to the same persisted fact', () => {
    const evidence = buildFinancialEvidence({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCalls: [quoteCall()],
    });
    const envelope = evidence[0]!;
    const block = renderBlockFence({
      version: 1,
      type: 'metric_grid',
      title: 'AAPL',
      evidenceIds: [envelope.id],
      metrics: [{
        label: 'Last',
        value: 210,
        unit: 'price',
        currency: 'USD',
        evidenceIds: ['quote-1'],
      }],
    });
    const answer = appendBlocksToAnswer(
      `Apple last traded at 210 USD. ${renderCitationMarker('quote-1')} ${renderCitationMarker('missing-tool')}`,
      [JSON.parse(block.slice(block.indexOf('\n') + 1, block.lastIndexOf('\n```')))]
    );
    const trace = resolveCopilotCitationTrace({
      question: "What is Apple's current price, and where did it come from?",
      answer,
      financialEvidence: evidence,
    });

    expect(trace.schemaVersion).toBe('folio-citation-trace/v1');
    expect(trace.citations.map((citation) => citation.citationId)).toEqual(['quote-1', 'missing-tool', envelope.id]);

    const byTool = trace.citations[0]!;
    const gap = trace.citations[1]!;
    const byEnvelope = trace.citations[2]!;

    expect(byTool).toMatchObject({
      origin: 'inline',
      resolution: 'tool_call',
      envelopeId: envelope.id,
      toolCallId: 'quote-1',
      toolName: 'get_quote',
      runId: 'run-1',
      provider: 'massive',
      instrumentId: 'XNAS:AAPL',
      metric: 'lastPrice',
      value: 210,
      currency: 'USD',
      unit: 'price',
      asOf: 1_710_000_000_456,
      retrievedAt: 1_710_000_000_123,
      delayed: true,
      stale: false,
      fallback: { from: 'longbridge', to: 'massive', reason: 'TIMEOUT' },
      availability: 'conflicted',
    });
    expect(byTool.asOf).not.toBe(byTool.retrievedAt);
    expect(byTool.value).not.toBe(200);
    expect(byTool.reconciliation?.candidates).toEqual([
      { provider: 'longbridge', value: 100, currency: 'USD', unit: 'price' },
      { provider: 'massive', value: 300, currency: 'USD', unit: 'price' },
    ]);
    expect(byTool.values.find((value) => value.metric === 'lastPrice')?.evidenceId).toMatch(/^ev_/);

    expect(gap).toMatchObject({ resolution: 'unmapped', availability: 'unmapped', values: [] });
    expect(gap.provider).toBeUndefined();
    expect(gap.value).toBeUndefined();

    expect(byEnvelope.resolution).toBe('envelope');
    expect(byEnvelope.envelopeId).toBe(byTool.envelopeId);
    expect(byEnvelope.values.map((value) => value.evidenceId)).toEqual(byTool.values.map((value) => value.evidenceId));
    expect(byEnvelope.availability).toBe('conflicted');
  });

  it('is unchanged when the same persisted messages are reloaded', () => {
    const evidence = buildFinancialEvidence({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCalls: [quoteCall()],
    });
    const answer = `Price ${renderCitationMarker('quote-1')}`;
    const question = 'What is AAPL worth?';
    const first = resolveCopilotCitationTrace({ question, answer, financialEvidence: evidence });
    const reloaded = JSON.parse(JSON.stringify({ question, answer, financialEvidence: evidence })) as {
      question: string;
      answer: string;
      financialEvidence: typeof evidence;
    };
    const second = resolveCopilotCitationTrace(reloaded);
    expect(second).toEqual(first);

    const reworded = resolveCopilotCitationTrace({ ...reloaded, question: 'Ignore the saved price and use today\'s quote.' });
    expect(reworded.citations).toEqual(first.citations);
    expect(reworded.question).not.toBe(first.question);
  });

  it('ignores evidence ids inside an unclosed or non-typed fence', () => {
    const evidence = buildFinancialEvidence({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCalls: [quoteCall()],
    });
    const answer = [
      '```',
      'folio-block example',
      '{"evidenceIds":["not-a-real-block"]}',
      '```',
      '```folio-block',
      '{"version":1,"type":"metric_grid","metrics":[]}',
    ].join('\n');
    const trace = resolveCopilotCitationTrace({
      question: 'quote',
      answer,
      financialEvidence: evidence,
    });
    expect(trace.citations).toEqual([]);
  });
});

import { describe, expect, it } from 'bun:test';
import { PiEventAdapter } from './pi-event-adapter.ts';

function adapter(): PiEventAdapter {
  return new PiEventAdapter({ sessionId: 's1', runId: 'r1', now: () => 1 });
}

describe('PiEventAdapter provider usage (#17)', () => {
  it('carries provider-reported usage into the completed message', () => {
    const events = adapter().consume({
      type: 'agent_end',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'ok',
          usage: { input: 1200, output: 300, cacheRead: 800, cacheWrite: 0, cost: 0.05, totalTokens: 2300 },
        },
      ],
    });

    const completed = events.find((event) => event.type === 'message_completed');
    expect(completed?.payload).toMatchObject({
      usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.05 },
    });
  });

  it('reads usage from the event itself when the runtime reports it there', () => {
    const events = adapter().consume({
      type: 'agent_end',
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.001 },
    });

    const completed = events.find((event) => event.type === 'message_completed');
    expect(completed?.payload).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.001 },
    });
  });

  it('omits usage when the provider reports none', () => {
    const events = adapter().consume({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: 'ok' }],
    });

    const completed = events.find((event) => event.type === 'message_completed');
    expect(completed).toBeDefined();
    expect(completed?.payload).not.toHaveProperty('usage');
  });
});

describe('PiEventAdapter tool retry signal (#17)', () => {
  it('emits tool_retried when the same tool starts again right after an error', () => {
    const a = adapter();
    a.consume({ type: 'tool_execution_start', toolCallId: 't1', name: 'get_quote', args: { symbol: 'AAPL.US' } });
    a.consume({ type: 'tool_execution_end', toolCallId: 't1', name: 'get_quote', error: 'provider 5xx' });

    const events = a.consume({ type: 'tool_execution_start', toolCallId: 't2', name: 'get_quote', args: { symbol: 'AAPL.US' } });

    expect(events.map((event) => event.type)).toEqual(['tool_started', 'tool_retried']);
    const retried = events.find((event) => event.type === 'tool_retried');
    expect(retried?.payload).toMatchObject({ toolCall: { toolName: 'get_quote', status: 'running' } });
  });

  it('does not mark a retry when the previous execution succeeded', () => {
    const a = adapter();
    a.consume({ type: 'tool_execution_start', toolCallId: 't1', name: 'get_quote' });
    a.consume({ type: 'tool_execution_end', toolCallId: 't1', name: 'get_quote', result: 'ok' });

    const events = a.consume({ type: 'tool_execution_start', toolCallId: 't2', name: 'get_quote' });

    expect(events.map((event) => event.type)).toEqual(['tool_started']);
  });

  it('tracks the last error per tool name, not globally', () => {
    const a = adapter();
    a.consume({ type: 'tool_execution_start', toolCallId: 't1', name: 'get_quote' });
    a.consume({ type: 'tool_execution_end', toolCallId: 't1', name: 'get_quote', error: 'boom' });

    const events = a.consume({ type: 'tool_execution_start', toolCallId: 't2', name: 'web_search' });

    expect(events.map((event) => event.type)).toEqual(['tool_started']);
  });

  it('stops marking retries once the tool succeeds again', () => {
    const a = adapter();
    a.consume({ type: 'tool_execution_start', toolCallId: 't1', name: 'get_quote' });
    a.consume({ type: 'tool_execution_end', toolCallId: 't1', name: 'get_quote', error: 'boom' });
    a.consume({ type: 'tool_execution_start', toolCallId: 't2', name: 'get_quote' });
    a.consume({ type: 'tool_execution_end', toolCallId: 't2', name: 'get_quote', result: 'ok' });

    const events = a.consume({ type: 'tool_execution_start', toolCallId: 't3', name: 'get_quote' });

    expect(events.map((event) => event.type)).toEqual(['tool_started']);
  });
});

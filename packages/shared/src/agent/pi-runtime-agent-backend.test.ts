import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'bun:test';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { PiRuntimeAdapter } from './pi-runtime-adapter.ts';
import { PiRpcClient, readDefaultPiArgs, readDefaultPiCommand } from './pi-rpc-client.ts';

const touchedEnvKeys = [
  'FINAGENT_PI_COMMAND',
  'FINAGENT_PI_ARGS',
  'FINAGENT_PI_PROVIDER',
  'FINAGENT_PI_MODEL',
  'ANTHROPIC_MODEL',
] as const;

afterEach(() => {
  for (const key of touchedEnvKeys) {
    delete process.env[key];
  }
});

class FakePiProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 1234;
  private received: string[] = [];

  constructor(
    private readonly handler: (line: Record<string, unknown>, proc: FakePiProcess) => void
  ) {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk) => {
      buffer += String(chunk);
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          this.received.push(line);
          this.handler(JSON.parse(line) as Record<string, unknown>, this);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  }

  kill() {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  writeEvent(event: Record<string, unknown>) {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  commands() {
    return this.received.map((line) => (JSON.parse(line) as { type: string }).type);
  }
}

function createSpawn(factory: (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => FakePiProcess) {
  return (command: string, args: string[], options: SpawnOptionsWithoutStdio) =>
    factory(command, args, options) as never;
}

describe('PiRpcClient', () => {
  it('uses the project default pi runtime command and args', () => {
    process.env.ANTHROPIC_MODEL = 'MiniMax-M2.7';

    expect(readDefaultPiCommand()).toBe('bunx');
    expect(readDefaultPiArgs()).toEqual([
      '@mariozechner/pi-coding-agent',
      '--mode',
      'rpc',
      '--provider',
      'anthropic',
      '--model',
      'MiniMax-M2.7',
      '--extension',
      '.pi/extensions/finagent/index.ts',
    ]);
  });

  it('honors explicit FINAGENT_PI_COMMAND and FINAGENT_PI_ARGS overrides', () => {
    process.env.FINAGENT_PI_COMMAND = 'pi';
    process.env.FINAGENT_PI_ARGS = '--mode rpc --provider openai';

    expect(readDefaultPiCommand()).toBe('pi');
    expect(readDefaultPiArgs()).toEqual(['--mode', 'rpc', '--provider', 'openai']);
  });

  it('switches to a session file and reports the runtime session identity', async () => {
    let sessions: string[] = [];
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'switch_session') {
            sessions.push(String(line.sessionPath));
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'switch_session',
              success: true,
            });
          }
          if (line.type === 'get_state') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: {
                sessionId: 'pi-123',
                sessionFile: '/tmp/s1.jsonl',
              },
            });
          }
        })
      ),
    });

    const state = await client.switchSession('/tmp/s1.jsonl');

    expect(sessions).toEqual(['/tmp/s1.jsonl']);
    expect(state).toMatchObject({ sessionId: 'pi-123', sessionFile: '/tmp/s1.jsonl' });
  });

  it('streams raw Pi events and settles with the aggregated result', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'tool_execution_start',
              toolCallId: 'tool-1',
              toolName: 'get_quote',
              args: { symbol: 'AAPL.US' },
            });
            proc.writeEvent({
              id: line.id,
              type: 'tool_execution_end',
              toolCallId: 'tool-1',
              result: { symbol: 'AAPL.US' },
            });
            proc.writeEvent({
              id: line.id,
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'AAPL ' },
            });
            proc.writeEvent({
              id: line.id,
              type: 'agent_end',
              messages: [
                {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'AAPL looks stable.' }],
                },
              ],
            });
          }
        })
      ),
    });

    const stream = client.promptStreaming('quote AAPL.US');
    const types: string[] = [];
    let result: Awaited<ReturnType<typeof client.prompt>> | null = null;

    for await (const item of stream) {
      if (item.kind === 'event') {
        types.push(String(item.event.type));
      } else if (item.kind === 'end') {
        result = item.result;
      }
    }

    expect(types).toEqual([
      'tool_execution_start',
      'tool_execution_end',
      'message_update',
      'agent_end',
    ]);
    expect(result?.answer).toBe('AAPL looks stable.');
    expect(result?.toolCalls).toHaveLength(1);
  });

  it('aborts a running prompt and settles the stream as aborted', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'Partial ' },
            });
          }
          if (line.type === 'abort') {
            proc.writeEvent({ id: line.id, type: 'response', command: 'abort', success: true });
          }
        })
      ),
    });

    const stream = client.promptStreaming('hello');
    const events: string[] = [];
    let result: unknown = null;

    const consume = (async () => {
      for await (const item of stream) {
        if (item.kind === 'event') events.push(String(item.event.type));
        else if (item.kind === 'end') result = item.result;
      }
    })();

    // Let the first delta arrive, then abort.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await stream.abort();
    await consume;

    expect(events).toContain('message_update');
    expect(result).toMatchObject({ aborted: true });
    expect((result as { answer: string }).answer).toBe('Partial');
  });

  it('rejects when Pi refuses a prompt before execution', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: false,
              error: 'StreamingBehavior required while agent is busy.',
            });
          }
        })
      ),
    });

    await expect(client.prompt('hello')).rejects.toMatchObject({
      code: 'PI_RUNTIME_ERROR',
      message: 'StreamingBehavior required while agent is busy.',
    });
  });

  it('rejects malformed JSONL output', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            proc.stdout.write('not-json\n');
          }
        })
      ),
    });

    await expect(client.prompt('hello')).rejects.toMatchObject({
      code: 'PI_PROTOCOL_ERROR',
    });
  });

  it('times out unanswered prompt requests', async () => {
    const client = new PiRpcClient({
      requestTimeoutMs: 5,
      spawnProcess: createSpawn(() => new FakePiProcess(() => undefined)),
    });

    await expect(client.prompt('hello')).rejects.toMatchObject({
      code: 'PI_REQUEST_TIMEOUT',
    });
  });

  it('rejects before spawn when required LLM env is missing', async () => {
    let spawned = false;
    const client = new PiRpcClient({
      requiredEnvKeys: ['FINAGENT_TEST_LLM_KEY'],
      spawnProcess: createSpawn(() => {
        spawned = true;
        return new FakePiProcess(() => undefined);
      }),
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: 'PI_LLM_ENV_MISSING',
      action: expect.stringContaining('.env.local'),
    });
    expect(spawned).toBe(false);
  });

  it('normalizes missing runtime commands into actionable errors', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() => {
        throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
      }),
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: 'PI_RUNTIME_NOT_FOUND',
      action: expect.stringContaining('FINAGENT_PI_COMMAND'),
    });
  });

  it('times out unfinished tool calls', async () => {
    const client = new PiRpcClient({
      singleToolTimeoutMs: 5,
      requestTimeoutMs: 100,
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'tool_execution_start',
              toolCallId: 'tool-1',
              toolName: 'get_quote',
              args: { symbol: 'AAPL.US' },
            });
          }
        })
      ),
    });

    await expect(client.prompt('quote')).rejects.toMatchObject({
      code: 'PI_TOOL_TIMEOUT',
    });
  });

  it('restarts on the next request after an abnormal exit', async () => {
    let starts = 0;
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() => {
        starts += 1;
        return new FakePiProcess((line, proc) => {
          if (starts === 1) {
            proc.emit('exit', 1, null);
            return;
          }
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: 'restarted' }] }],
            });
          }
        });
      }),
    });

    await expect(client.prompt('first')).rejects.toMatchObject({
      code: 'PI_RUNTIME_EXITED',
    });
    await expect(client.prompt('second')).resolves.toMatchObject({
      answer: 'restarted',
    });
    expect(starts).toBe(2);
  });
});

describe('PiRuntimeAdapter', () => {
  it('maps a Pi run into the Folio AgentEvent sequence', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'switch_session') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'switch_session',
              success: true,
            });
            return;
          }
          if (line.type === 'get_state') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: { sessionId: 'pi-1', sessionFile: '/tmp/s.jsonl' },
            });
            return;
          }
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'tool_execution_start',
              toolCallId: 'tool-1',
              toolName: 'get_portfolio',
              args: {},
            });
            proc.writeEvent({
              id: line.id,
              type: 'tool_execution_end',
              toolCallId: 'tool-1',
              result: { totalValue: 100 },
            });
            proc.writeEvent({
              id: line.id,
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'Portfolio risk is ' },
            });
            proc.writeEvent({
              id: line.id,
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'moderate.' },
            });
            proc.writeEvent({
              id: line.id,
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Portfolio risk is moderate.' }] }],
            });
          }
        })
      ),
    });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, now: () => 1710000000000 });

    const runtimeSession = await adapter.ensureSession({ id: 's1', sessionPath: '/tmp/s.jsonl' });
    expect(runtimeSession).toMatchObject({ runtimeSessionId: 'pi-1', status: 'active' });

    const types: string[] = [];
    const toolCalls: unknown[] = [];
    let finalAnswer = '';
    for await (const event of adapter.run({ sessionId: 's1', runId: 'r1', content: '分析我的组合风险' })) {
      types.push(event.type);
      if (event.type === 'tool_started' || event.type === 'tool_completed') {
        toolCalls.push(event.payload.toolCall.toolName);
      }
      if (event.type === 'run_completed') {
        finalAnswer = event.payload.answer;
      }
    }

    expect(types).toEqual([
      'tool_started',
      'tool_completed',
      'message_started',
      'message_delta',
      'message_delta',
      'message_completed',
      'run_completed',
    ]);
    expect(toolCalls).toEqual(['get_portfolio', 'get_portfolio']);
    expect(finalAnswer).toBe('Portfolio risk is moderate.');
  });

  it('isolates sessions by switching the runtime session file', async () => {
    const switched: string[] = [];
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'switch_session') {
            switched.push(String(line.sessionPath));
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'switch_session',
              success: true,
            });
          }
          if (line.type === 'get_state') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: { sessionId: `pi-${switched.length}`, sessionFile: String(line.sessionPath ?? '') },
            });
          }
        })
      ),
    });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, sessionDir: '/tmp/pi' });

    await adapter.ensureSession({ id: 's1' });
    await adapter.ensureSession({ id: 's2' });
    await adapter.ensureSession({ id: 's1' });

    expect(switched).toEqual(['/tmp/pi/s1.jsonl', '/tmp/pi/s2.jsonl', '/tmp/pi/s1.jsonl']);
  });

  it('ends a cancelled run with a RUN_CANCELLED failure event', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'switch_session') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'switch_session',
              success: true,
            });
          }
          if (line.type === 'get_state') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'get_state',
              success: true,
              data: { sessionId: 'pi-1' },
            });
          }
          if (line.type === 'prompt') {
            proc.writeEvent({
              id: line.id,
              type: 'response',
              command: 'prompt',
              success: true,
            });
            proc.writeEvent({
              id: line.id,
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'Half an answer' },
            });
          }
          if (line.type === 'abort') {
            proc.writeEvent({ id: line.id, type: 'response', command: 'abort', success: true });
          }
        })
      ),
    });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, sessionDir: '/tmp/pi' });

    const types: string[] = [];
    const consume = (async () => {
      for await (const event of adapter.run({ sessionId: 's1', runId: 'r1', content: 'hello' })) {
        types.push(event.type);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.cancel({ sessionId: 's1', runId: 'r1' });
    await consume;

    expect(types).toEqual(['message_started', 'message_delta', 'message_completed', 'run_failed']);
    expect(types).toContain('run_failed');
  });

  it('fails the run when the runtime cannot start', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() => {
        throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
      }),
    });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, sessionDir: '/tmp/pi' });

    const types: string[] = [];
    const errors: string[] = [];
    for await (const event of adapter.run({ sessionId: 's1', runId: 'r1', content: 'hello' })) {
      types.push(event.type);
      if (event.type === 'run_failed') {
        errors.push(event.payload.error.code);
      }
    }

    expect(types).toEqual(['run_failed']);
    expect(errors).toEqual(['PI_RUNTIME_NOT_FOUND']);
  });
});

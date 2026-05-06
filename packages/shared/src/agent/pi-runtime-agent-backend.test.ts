import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'bun:test';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { PiRuntimeAgentBackend } from './pi-runtime-agent-backend.ts';
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

  it('collects JSONL answer and tool call events', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn((_command, _args, _options) =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'prompt') {
            expect(line.message).toBe('quote AAPL.US');
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
              assistantMessageEvent: {
                type: 'text_delta',
                delta: 'AAPL ',
              },
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

    const result = await client.prompt('quote AAPL.US');

    expect(result.answer).toBe('AAPL looks stable.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'tool-1',
      toolName: 'get_quote',
      status: 'success',
      args: { symbol: 'AAPL.US' },
    });
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

  it('normalizes non-executable runtime commands into actionable errors', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() => {
        throw Object.assign(new Error('spawn pi EACCES'), { code: 'EACCES' });
      }),
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: 'PI_RUNTIME_NOT_EXECUTABLE',
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

describe('PiRuntimeAgentBackend', () => {
  it('returns unified ApiResult responses with answer, tools, session, and trace', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() =>
        new FakePiProcess((line, proc) => {
          if (line.type === 'get_state') {
            proc.writeEvent({ id: line.id, type: 'state', status: 'ok' });
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
            proc.writeEvent({ id: line.id, type: 'tool_execution_end', toolCallId: 'tool-1' });
            proc.writeEvent({
              id: line.id,
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Portfolio risk is moderate.' }] }],
            });
          }
        })
      ),
    });
    const backend = new PiRuntimeAgentBackend({ rpcClient: client });

    const result = await backend.send({ sessionId: 's1', content: '分析我的组合风险' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.answer).toBe('Portfolio risk is moderate.');
    expect(result.data.toolCalls).toHaveLength(1);
    expect(result.data.sessionSnapshot.id).toBe('s1');
    expect(result.data.trace?.length).toBeGreaterThan(0);
  });

  it('returns structured errors when Pi startup fails', async () => {
    const client = new PiRpcClient({
      spawnProcess: createSpawn(() => {
        throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
      }),
    });
    const backend = new PiRuntimeAgentBackend({ rpcClient: client });

    const result = await backend.send({ sessionId: 's1', content: 'hello' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.code).toBe('PI_RUNTIME_NOT_FOUND');
    expect(result.error.action).toContain('FINAGENT_PI_COMMAND');
  });
});

function createSpawn(factory: (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => FakePiProcess) {
  return (command: string, args: string[], options: SpawnOptionsWithoutStdio) =>
    factory(command, args, options) as never;
}

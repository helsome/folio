// LLM control-plane RPC tests: model listing, model switching, thinking
// levels, and runtime restart with a scripted fake Pi process.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'bun:test';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { PiRpcClient } from './pi-rpc-client.ts';

class FakePiProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 7;
  received: Record<string, unknown>[] = [];
  spawns = 0;

  constructor(private readonly onLine?: (line: Record<string, unknown>, proc: FakePiProcess) => void) {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk) => {
      buffer += String(chunk);
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          this.received.push(parsed);
          this.onLine?.(parsed, this);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  }

  respond(line: Record<string, unknown>, payload: Record<string, unknown>) {
    this.stdout.write(`${JSON.stringify({ ...payload, id: line.id })}\n`);
  }

  kill() {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}


const MODELS = [
  { id: 'claude-x', provider: 'anthropic', name: 'Claude X', contextWindow: 200000, reasoning: true },
  { id: 'gpt-x', provider: 'openai', name: 'GPT X', contextWindow: 128000, reasoning: true },
];

function scriptedClient(handler: (line: Record<string, unknown>, proc: FakePiProcess) => void, spawns?: number[]) {
  return new PiRpcClient({
    spawnProcess: (_command, _args, _options) => {
      const proc = new FakePiProcess(handler);
      spawns?.push(1);
      return proc as never;
    },
  });
}

describe('PiRpcClient LLM control plane', () => {
  it('lists models from get_available_models', async () => {
    const client = scriptedClient((line, proc) => {
      if (line.type === 'get_available_models') {
        proc.respond(line, { type: 'response', command: 'get_available_models', success: true, data: { models: MODELS } });
      }
    });

    const models = await client.getAvailableModels();
    expect(models).toHaveLength(2);
    expect(models[0]?.provider).toBe('anthropic');
    expect(models[1]?.contextWindow).toBe(128000);
  });

  it('switches models via set_model and reports the new model', async () => {
    const client = scriptedClient((line, proc) => {
      if (line.type === 'set_model') {
        expect(line.provider).toBe('openai');
        expect(line.modelId).toBe('gpt-x');
        proc.respond(line, { type: 'response', command: 'set_model', success: true, data: MODELS[1] });
      }
    });

    const model = await client.setModel('openai', 'gpt-x');
    expect(model.id).toBe('gpt-x');
  });

  it('reports model errors as PI_PROTOCOL_ERROR on malformed payloads', async () => {
    const client = scriptedClient((line, proc) => {
      if (line.type === 'get_available_models') {
        proc.respond(line, { type: 'response', command: 'get_available_models', success: true, data: {} });
      }
    });

    await expect(client.getAvailableModels()).rejects.toThrow('no models list');
  });

  it('sets thinking level', async () => {
    let received: string | undefined;
    const client = scriptedClient((line, proc) => {
      if (line.type === 'set_thinking_level') {
        received = String(line.level);
        proc.respond(line, { type: 'response', command: 'set_thinking_level', success: true });
      }
    });

    await client.setThinkingLevel('high');
    expect(received).toBe('high');
  });

  it('restart() kills the process and respawns on the next command', async () => {
    const spawns: number[] = [];
    const client = scriptedClient((line, proc) => {
      if (line.type === 'get_state') {
        proc.respond(line, { type: 'response', command: 'get_state', success: true, data: { sessionId: 'x', thinkingLevel: 'off' } });
      }
    }, spawns);

    await client.getState();
    await client.restart();
    await client.getState();
    expect(spawns).toHaveLength(2);
  });

  it('reads enriched get_state (model + thinking level)', async () => {
    const client = scriptedClient((line, proc) => {
      if (line.type === 'get_state') {
        proc.respond(line, {
          type: 'response',
          command: 'get_state',
          success: true,
          data: {
            sessionId: 's-9',
            model: MODELS[0],
            thinkingLevel: 'high',
            isStreaming: false,
            messageCount: 3,
          },
        });
      }
    });

    const state = await client.getState();
    expect(state.model?.id).toBe('claude-x');
    expect(state.thinkingLevel).toBe('high');
    expect(state.messageCount).toBe(3);
  });
});

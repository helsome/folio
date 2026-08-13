// Workspace context → prompt integration: verifies the run path threads the
// renderer's workspace context into the prompt the Pi runtime receives, and
// that the progressive skill index is injected.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'bun:test';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { PiRuntimeAdapter } from './pi-runtime-adapter.ts';
import { PiRpcClient } from './pi-rpc-client.ts';
import type { SkillHub } from '@finagent/skill-hub';

class FakePiProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 42;
  received: Record<string, unknown>[] = [];

  constructor() {
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
          this.respond(parsed);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  }

  private respond(line: Record<string, unknown>) {
    if (line.type === 'switch_session') {
      this.stdout.write(`${JSON.stringify({
        id: line.id,
        type: 'response',
        command: 'switch_session',
        success: true,
      })}\n`);
    } else if (line.type === 'get_state') {
      this.stdout.write(`${JSON.stringify({
        id: line.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: { sessionId: 'rt-1', thinkingLevel: 'off', isStreaming: false },
      })}\n`);
    } else if (line.type === 'prompt') {
      this.stdout.write(`${JSON.stringify({ id: line.id, type: 'response', command: 'prompt', success: true })}\n`);
      this.stdout.write(`${JSON.stringify({ type: 'agent_end', messages: [] })}\n`);
    }
  }

  kill() {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}

function createSpawn(proc: FakePiProcess) {
  return (_command: string, _args: string[], _options: SpawnOptionsWithoutStdio) => proc as never;
}

function fakeSkillHub(): SkillHub {
  return {
    listSkillMetadata: () => [
      { id: 'longbridge-market-data', name: 'market data', description: 'Quotes and K-lines.', keywords: [] },
      { id: 'longbridge-technical', name: 'technical', description: 'Technical analysis.', keywords: [] },
    ],
  } as unknown as SkillHub;
}

describe('WorkspaceContext → prompt', () => {
  it('injects active symbol and view into the Pi prompt', async () => {
    const proc = new FakePiProcess();
    const client = new PiRpcClient({ spawnProcess: createSpawn(proc) });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, sessionDir: '/tmp/ws-test' });

    const events = [];
    for await (const event of adapter.run({
      sessionId: 's1',
      runId: 'r1',
      content: '最近走势怎么样？',
      workspaceContext: { activeSymbol: 'NVDA.US', activeView: 'chart' },
    })) {
      events.push(event.type);
    }

    const prompt = proc.received.find((line) => line.type === 'prompt');
    expect(prompt).toBeDefined();
    const message = String(prompt?.message ?? '');
    expect(message).toContain('Active symbol: NVDA.US');
    expect(message).toContain('Active workspace view: chart');
    expect(message).toContain('use the active symbol above');
    expect(events).toContain('run_completed');
  });

  it('omits the workspace section when no context is provided', async () => {
    const proc = new FakePiProcess();
    const client = new PiRpcClient({ spawnProcess: createSpawn(proc) });
    const adapter = new PiRuntimeAdapter({ rpcClient: client, sessionDir: '/tmp/ws-test' });

    for await (const _event of adapter.run({ sessionId: 's2', runId: 'r2', content: 'hello' })) {
      // Drain.
    }

    const prompt = proc.received.find((line) => line.type === 'prompt');
    expect(String(prompt?.message ?? '')).not.toContain('Workspace context');
  });

  it('injects the progressive skill index when a skill hub is present', async () => {
    const proc = new FakePiProcess();
    const client = new PiRpcClient({ spawnProcess: createSpawn(proc) });
    const adapter = new PiRuntimeAdapter({
      rpcClient: client,
      sessionDir: '/tmp/ws-test',
      skillHub: fakeSkillHub(),
    });

    for await (const _event of adapter.run({ sessionId: 's3', runId: 'r3', content: 'analyze NVDA' })) {
      // Drain.
    }

    const prompt = proc.received.find((line) => line.type === 'prompt');
    const message = String(prompt?.message ?? '');
    expect(message).toContain('Available skills');
    expect(message).toContain('longbridge-market-data: Quotes and K-lines.');
    expect(message).toContain('longbridge-technical: Technical analysis.');
  });
});

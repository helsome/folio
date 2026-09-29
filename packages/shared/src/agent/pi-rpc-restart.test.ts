import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { PiRpcClient } from './pi-rpc-client.ts';

class DeferredExitProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 7;

  kill() {
    // Real child processes emit exit asynchronously, after kill() returns.
    this.killed = true;
    return true;
  }

  respond(request: Record<string, unknown>) {
    this.stdout.write(`${JSON.stringify({
      id: request.id, type: 'response', success: true, data: { sessionId: 'current' },
    })}\n`);
  }
}

describe('PiRpcClient process ownership after restart', () => {
  const staleEvents = {
    exit: (proc: DeferredExitProcess) => proc.emit('exit', 1, null),
    error: (proc: DeferredExitProcess) => proc.emit('error', new Error('old process error')),
    stdout: (proc: DeferredExitProcess) => proc.stdout.write('not JSON\n'),
    stderr: (proc: DeferredExitProcess) => proc.stderr.write('old process stderr\n'),
  };

  for (const [name, emitStale] of Object.entries(staleEvents)) {
    for (const requestType of ['control', 'prompt'] as const) {
      it(`ignores retired ${name} while a new ${requestType} is pending`, async () => {
        const processes: DeferredExitProcess[] = [];
        const logs: unknown[] = [];
        const client = new PiRpcClient({
          onLog: (log) => logs.push(log),
          spawnProcess: () => {
            const proc = new DeferredExitProcess();
            processes.push(proc);
            proc.stdin.once('data', (chunk) => {
              const request = JSON.parse(String(chunk));
              if (processes.length === 2) emitStale(processes[0]!);
              if (request.type === 'prompt') {
                proc.stdout.write(`${JSON.stringify({ type: 'agent_end', messages: [] })}\n`);
              } else {
                proc.respond(request);
              }
            });
            return proc as never;
          },
        });
        try {
          await client.getState();
          await client.restart();
          if (requestType === 'control') {
            expect((await client.getState()).sessionId).toBe('current');
          } else {
            const result = await client.prompt('hello');
            expect(result.trace.some((event) => event.type === 'stderr')).toBe(false);
          }
          expect(client.isRuntimeAlive()).toBe(true);
          expect(client.getLastExitInfo()).toBeNull();
          expect(logs).toEqual([]);
          expect(processes).toHaveLength(2);
        } finally {
          await client.dispose();
        }
      });
    }
  }

  it('still rejects pending requests and records exit info for the current process', async () => {
    const proc = new DeferredExitProcess();
    const client = new PiRpcClient({ spawnProcess: () => proc as never });
    proc.stdin.once('data', () => proc.emit('exit', 2, null));
    try {
      await expect(client.getState()).rejects.toThrow('Pi runtime exited with code 2');
      expect(client.isRuntimeAlive()).toBe(false);
      expect(client.getLastExitInfo()).toEqual({ code: 2, signal: null });
    } finally {
      await client.dispose();
    }
  });

  it('can restart across real child-process JSONL pipes', async () => {
    const children: ReturnType<typeof spawn>[] = [];
    const exits: Promise<unknown>[] = [];
    // A protocol fixture, not a live model: exercise actual spawn/stdio/exit.
    const script = `
      const { createInterface } = require('node:readline');
      createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({
          id: request.id, type: 'response', success: true,
          data: { sessionId: String(process.pid) }
        }) + '\\n');
      });
    `;
    const client = new PiRpcClient({
      command: process.execPath,
      args: ['-e', script],
      spawnProcess: (command, args, options) => {
        const child = spawn(command, args, options);
        children.push(child);
        exits.push(once(child, 'exit'));
        return child;
      },
    });
    try {
      expect((await client.getState()).sessionId).toBe(String(children[0]!.pid));
      await client.restart();
      await exits[0];
      expect((await client.getState()).sessionId).toBe(String(children[1]!.pid));
      expect(children).toHaveLength(2);
      expect(client.isRuntimeAlive()).toBe(true);
    } finally {
      await client.dispose();
      for (const child of children) if (!child.killed) child.kill();
      await Promise.all(exits);
    }
  });
});

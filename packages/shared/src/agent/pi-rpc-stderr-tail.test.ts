import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'bun:test';
import { PiRpcClient } from './pi-rpc-client.ts';

/**
 * Regression coverage for the Pi stderr diagnostics tail (V8.1 §40).
 *
 * `getRecentStderr()` backs two production consumers:
 *   1. `PiRuntimeAdapter.getRuntimeDiagnostics().stderrTail` — the Diagnostics
 *      tab; it is `null` whenever the tail is empty.
 *   2. `PiRuntimeAdapter.isOptionalExtensionFailure()` — it greps the tail for
 *      a broken optional-extension signature before degrading the run to the
 *      Finagent core extension (V8.1 §37).
 *
 * A real Pi runtime terminates every diagnostic with "\n", so the tail must
 * retain newline-terminated lines. Keeping only the unterminated remainder of
 * the current chunk makes both consumers blind: the degrade check never fires
 * and Diagnostics reports `stderrTail: null` while the runtime printed plenty.
 */

class FakePiProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 4245;

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
          const payload = JSON.parse(line) as Record<string, unknown>;
          this.stdout.write(
            `${JSON.stringify({
              type: 'response',
              command: payload.type,
              id: payload.id,
              success: true,
              data: {},
            })}\n`
          );
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
}

function wait(ms = 10) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Spawn a fake runtime and complete the JSONL handshake. */
async function startClient() {
  const procs: FakePiProcess[] = [];
  const client = new PiRpcClient({
    command: 'pi',
    args: [],
    spawnProcess: () => {
      const proc = new FakePiProcess();
      procs.push(proc);
      return proc as never;
    },
  });
  await client.healthCheck();
  return { proc: procs[0]!, procs, client };
}

describe('PiRpcClient stderr diagnostics tail', () => {
  it('keeps newline-terminated stderr lines in getRecentStderr', async () => {
    const { proc, client } = await startClient();

    proc.stderr.write('Error: Failed to load extension .pi/extensions/foo.ts\n');
    await wait();

    expect(client.getRecentStderr()).toContain('Failed to load extension .pi/extensions/foo.ts');
  });

  it('exposes the optional-extension signature the adapter greps for', async () => {
    const { proc, client } = await startClient();

    // Multi-line startup diagnostics exactly as the Pi runtime prints them.
    proc.stderr.write("Error: Failed to load extension '/repo/.pi/extensions/langsmith/index.ts'\n");
    proc.stderr.write("Cannot find module '@langchain/langsmith-pi-extension'\n");
    await wait();

    const tail = client.getRecentStderr();
    expect(tail).toContain('Cannot find module');
    expect(/Failed to load extension|Cannot find module|Error loading extension/i.test(tail)).toBe(true);
  });

  it('bounds the retained history and keeps the most recent lines', async () => {
    const { proc, client } = await startClient();

    // ~20 KB of newline-terminated diagnostics: more than the retained history.
    const lineCount = 500;
    for (let index = 0; index < lineCount; index += 1) {
      proc.stderr.write(`diagnostic line ${index} ${'x'.repeat(30)}\n`);
    }
    await wait(50);

    const tail = client.getRecentStderr(6000);
    expect(tail.length).toBeLessThanOrEqual(6000);
    expect(tail).toContain(`diagnostic line ${lineCount - 1}`);
    // The oldest lines must have been evicted, not merely hidden by the slice.
    expect(tail).not.toContain('diagnostic line 0 ');
  });

  it('reports an empty tail before any stderr arrives', async () => {
    const { client } = await startClient();
    expect(client.getRecentStderr()).toBe('');
  });

  it('does not carry stderr across runtime processes', async () => {
    const { proc, client } = await startClient();
    proc.stderr.write('stale diagnostic from the previous process\n');
    await wait();
    expect(client.getRecentStderr()).toContain('stale diagnostic');

    // The runtime exits, then a fresh process is spawned on the next command.
    await client.restart();
    await client.healthCheck();
    expect(client.getRecentStderr()).toBe('');
  });
});

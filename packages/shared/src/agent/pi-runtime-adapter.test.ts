import { describe, expect, it } from 'bun:test';
import { createCodeError } from './errors.ts';
import { PiRuntimeAdapter } from './pi-runtime-adapter.ts';

/**
 * Fake PiRpcClient: first promptStreaming throws a runtime-exited error with a
 * stderr signature that points at an *optional extension* load failure; the
 * second call (after the adapter retries core-only) succeeds. This models
 * V8.1 §37 — observability must never block agent execution.
 */
class FakeRpcClient {
  extensionCalls: string[][] = [];
  currentExtensions: string[] = [];
  attempts = 0;
  stderr =
    "Error: Failed to load extension .../langsmith/index.ts: Cannot find module '@langchain/langsmith-pi-extension'";

  updateExtensions(extensions: string[]): void {
    this.extensionCalls.push([...extensions]);
    this.currentExtensions = [...extensions];
  }

  async restart(): Promise<void> {}

  async switchSession(sessionPath: string): Promise<{ sessionId: string }> {
    return { sessionId: `s-${sessionPath.length}` };
  }

  getRecentStderr(): string {
    return this.stderr;
  }

  getLastExitInfo(): { code: number | null; signal: string | null } | null {
    return this.attempts >= 1 ? { code: 1, signal: null } : null;
  }

  isRuntimeAlive(): boolean {
    return false;
  }

  getLaunchInfo(): { command: string; args: string[]; cwd: string; extensions: string[] } {
    return {
      command: 'bunx',
      args: ['pi', '--mode', 'rpc', ...this.currentExtensions.flatMap((e) => ['--extension', e])],
      cwd: '/repo',
      extensions: [...this.currentExtensions],
    };
  }

  promptStreaming(_content: string): any {
    this.attempts += 1;
    if (this.attempts === 1) {
      // First spawn dies at startup (optional extension failed to load).
      return (async function* () {
        throw createCodeError(
          'PI_RUNTIME_EXITED',
          'Pi runtime exited with code 1.',
          'Restart the runtime or check the Diagnostics tab.'
        );
      })();
    }
    // Retry succeeds.
    return (async function* () {
      yield { kind: 'end', result: { aborted: false } };
    })();
  }
}

function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  return (async () => {
    for await (const item of iterable) out.push(item);
    return out;
  })();
}

describe('PiRuntimeAdapter retry-once isolation (V8.1 §37)', () => {
  it('retries once with the Finagent core extension when an optional extension fails to load', async () => {
    const rpc = new FakeRpcClient();
    const adapter = new PiRuntimeAdapter({ rpcClient: rpc as never });
    adapter.setExtensions(['.pi/extensions/finagent/index.ts', '.pi/extensions/langsmith/index.ts']);

    const events = await drain(adapter.run({ sessionId: 'a', runId: 'r1', content: 'hi' }));

    // Compatible terminal, retried core-only.
    expect(rpc.extensionCalls).toEqual([
      ['.pi/extensions/finagent/index.ts', '.pi/extensions/langsmith/index.ts'],
      ['.pi/extensions/finagent/index.ts'],
    ]);
    expect(adapter.isObservabilityDegraded()).toBe(true);
    // No spurious run_failed was emitted for the suppressed first attempt.
    expect(events.some((e) => (e as { type?: string }).type === 'run_failed')).toBe(false);
  });

  it('does not degrade when only the core extension is configured', async () => {
    const rpc = new FakeRpcClient();
    const adapter = new PiRuntimeAdapter({ rpcClient: rpc as never });
    adapter.setExtensions(['.pi/extensions/finagent/index.ts']);

    await drain(adapter.run({ sessionId: 'a', runId: 'r2', content: 'hi' }));

    // Core-only: nothing to degrade to, so no retry — single extension commit.
    expect(rpc.extensionCalls).toEqual([['.pi/extensions/finagent/index.ts']]);
    expect(adapter.isObservabilityDegraded()).toBe(false);
  });

  it('does not retry without signature-matched optional-extension failures', async () => {
    const rpc = new FakeRpcClient();
    rpc.stderr = 'Some other stderr with no extension markers.';
    const adapter = new PiRuntimeAdapter({ rpcClient: rpc as never });
    adapter.setExtensions(['.pi/extensions/finagent/index.ts', '.pi/extensions/langsmith/index.ts']);

    const events = await drain(adapter.run({ sessionId: 'a', runId: 'r3', content: 'hi' }));

    // No matching signature → no retry, terminal run_failed is emitted.
    expect(rpc.extensionCalls).toEqual([
      ['.pi/extensions/finagent/index.ts', '.pi/extensions/langsmith/index.ts'],
    ]);
    expect(adapter.isObservabilityDegraded()).toBe(false);
    expect(events.some((e) => (e as { type?: string }).type === 'run_failed')).toBe(true);
  });
});

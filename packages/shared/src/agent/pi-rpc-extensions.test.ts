import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { afterEach, describe, expect, it } from 'bun:test';
import { PiRpcClient, readDefaultPiArgs, readDefaultPiExtensions } from './pi-rpc-client.ts';

const extensionEnvKeys = [
  'FINAGENT_PI_EXTENSIONS',
  'FINAGENT_PI_EXTENSION',
  'FINAGENT_PI_ARGS',
  'FINAGENT_PI_COMMAND',
  'FINAGENT_PI_PROVIDER',
  'FINAGENT_PI_MODEL',
  'ANTHROPIC_MODEL',
] as const;

afterEach(() => {
  for (const key of extensionEnvKeys) {
    delete process.env[key];
  }
});

class FakePiProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 4242;

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

/** Values following each `--extension` flag, in spawn order. */
function extensionValues(args: string[]): string[] {
  return args.filter((part, index) => args[index - 1] === '--extension');
}

function extensionFlagCount(args: string[]): number {
  return args.filter((part) => part === '--extension').length;
}

describe('Pi extension spawn args', () => {
  it('FINAGENT_PI_EXTENSIONS is authoritative when set; legacy FINAGENT_PI_EXTENSION is not doubled in', () => {
    process.env.FINAGENT_PI_EXTENSIONS = 'a.ts,b.ts';
    process.env.FINAGENT_PI_EXTENSION = 'legacy.ts';

    expect(readDefaultPiExtensions()).toEqual(['a.ts', 'b.ts']);

    const args = readDefaultPiArgs();
    expect(extensionFlagCount(args)).toBe(2);
    expect(extensionValues(args)).toEqual(['a.ts', 'b.ts']);
  });

  it('falls back to the bundled finagent extension when no env vars are set', () => {
    delete process.env.FINAGENT_PI_EXTENSIONS;
    delete process.env.FINAGENT_PI_EXTENSION;

    expect(readDefaultPiExtensions()).toEqual(['.pi/extensions/finagent/index.ts']);

    const args = readDefaultPiArgs();
    expect(extensionFlagCount(args)).toBe(1);
    expect(extensionValues(args)).toEqual(['.pi/extensions/finagent/index.ts']);
  });

  it('legacy FINAGENT_PI_EXTENSION is used only when the extensions list is empty', () => {
    process.env.FINAGENT_PI_EXTENSION = 'legacy.ts';
    delete process.env.FINAGENT_PI_EXTENSIONS;

    expect(readDefaultPiExtensions()).toEqual(['legacy.ts']);

    const args = readDefaultPiArgs();
    expect(extensionFlagCount(args)).toBe(1);
    expect(extensionValues(args)).toEqual(['legacy.ts']);
  });

  it('PiRpcClientOptions.extensions overrides env vars in the spawned args', async () => {
    process.env.FINAGENT_PI_EXTENSIONS = 'env.ts';
    process.env.FINAGENT_PI_EXTENSION = 'env-legacy.ts';

    const spawned: { command: string; args: string[] }[] = [];
    const client = new PiRpcClient({
      extensions: ['opt-a.ts', 'opt-b.ts'],
      spawnProcess: (command: string, args: string[], _options: SpawnOptionsWithoutStdio) => {
        spawned.push({ command, args: [...args] });
        return new FakePiProcess((line, proc) => {
          if (line.type === 'get_state') {
            proc.writeEvent({ type: 'state', id: line.id, data: { sessionId: 's1' } });
          }
        }) as never;
      },
    });

    await client.healthCheck();

    expect(spawned).toHaveLength(1);
    expect(extensionFlagCount(spawned[0].args)).toBe(2);
    expect(extensionValues(spawned[0].args)).toEqual(['opt-a.ts', 'opt-b.ts']);
  });
});
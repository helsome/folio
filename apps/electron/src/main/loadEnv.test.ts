import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { loadFinagentEnv } from './loadEnv.ts';

const touchedKeys = new Set<string>();

afterEach(() => {
  for (const key of touchedKeys) {
    delete process.env[key];
  }
  touchedKeys.clear();
});

describe('loadFinagentEnv', () => {
  it('loads .env.local values without overriding shell-provided env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finagent-env-'));
    touchedKeys.add('FINAGENT_TEST_ENV_KEY');
    touchedKeys.add('FINAGENT_TEST_SHELL_KEY');

    process.env.FINAGENT_TEST_SHELL_KEY = 'shell';
    writeFileSync(join(dir, '.env'), [
      'FINAGENT_TEST_ENV_KEY=base',
      'FINAGENT_TEST_SHELL_KEY=file',
    ].join('\n'));
    writeFileSync(join(dir, '.env.local'), 'FINAGENT_TEST_ENV_KEY="local"\n');

    try {
      loadFinagentEnv({ roots: [dir] });
      expect(process.env.FINAGENT_TEST_ENV_KEY).toBe('local');
      expect(process.env.FINAGENT_TEST_SHELL_KEY).toBe('shell');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not walk into parent directories implicitly', () => {
    const parent = mkdtempSync(join(tmpdir(), 'finagent-env-parent-'));
    const child = join(parent, 'child');
    touchedKeys.add('FINAGENT_TEST_PARENT_KEY');

    writeFileSync(join(parent, '.env'), 'FINAGENT_TEST_PARENT_KEY=parent\n');

    try {
      loadFinagentEnv({ cwd: child });
      expect(process.env.FINAGENT_TEST_PARENT_KEY).toBeUndefined();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

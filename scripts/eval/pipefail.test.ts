// `... | tee ...` failure propagation (issue #113 acceptance): the same shell
// shape the nightly workflow uses must keep a non-zero exit when the wrapped
// command fails. Without `pipefail` the pipeline's status is `tee`'s 0 — the
// exact wrapper that turned a fully failed live run into a green Actions job.
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Locate a POSIX shell: `/bin/bash` on unix, Git Bash on Windows. */
function findBash(): string | undefined {
  if (process.platform !== 'win32') return existsSync('/bin/bash') ? '/bin/bash' : 'bash';
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (execPath.status === 0) {
    const gitRoot = execPath.stdout.trim().split(/[/\\]mingw64[/\\]/)[0];
    const candidate = join(gitRoot, 'bin', 'bash.exe');
    if (existsSync(candidate)) return candidate;
  }
  const fallback = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return existsSync(fallback) ? fallback : undefined;
}

const bash = findBash();
const withPipefail = bash ? describe : describe.skip;

withPipefail('pipeline exit codes', () => {
  it('swallows the failure without pipefail (the old nightly behavior)', () => {
    const result = spawnSync(bash as string, ['-c', 'false | tee /dev/null; echo "exit=$?"'], {
      encoding: 'utf8',
    });
    expect(result.stdout).toContain('exit=0');
  });

  it('preserves the underlying failure with pipefail (the fix)', () => {
    const result = spawnSync(
      bash as string,
      ['-c', 'set -o pipefail; false | tee /dev/null; echo "exit=$?"'],
      { encoding: 'utf8' }
    );
    expect(result.stdout).toContain('exit=1');
  });
});

// Execute the real workflow run block, replacing only the CLI with a fixture process.
// This verifies that exit 2 (invalid preflight) survives tee and is recorded for summary.
withPipefail('nightly invalid-run propagation', () => {
  it('keeps preflight exit 2 and records it without reporting a passing benchmark', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { delimiter } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'folio-nightly-exit-'));
    try {
      const workflow = readFileSync(join(import.meta.dir, '../../.github/workflows/eval-nightly.yml'), 'utf8');
      const block = workflow.split('      - name: Run full live eval')[1].split('        run: |\n')[1].split('        env:')[0];
      const script = block.split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n');
      const binary = join(dir, 'bun');
      writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "PREFLIGHT: NOT READY; no cases were run"\nexit 2\n');
      chmodSync(binary, 0o755);
      const output = join(dir, 'step-output.txt');
      const result = spawnSync(bash as string, ['-c', script], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: dir + delimiter + process.env.PATH, GITHUB_OUTPUT: output },
      });
      expect(result.status).toBe(2);
      expect(readFileSync(output, 'utf8')).toContain('exit_code=2');
      expect(readFileSync(join(dir, 'artifacts/eval-full.log'), 'utf8')).toContain('no cases were run');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

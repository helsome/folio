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

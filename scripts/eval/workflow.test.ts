// Nightly workflow guards (issue #113): the live eval must be able to fail
// the job, and the pipeline must preserve the CLI's exit code.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(
  join(import.meta.dir, '..', '..', '.github', 'workflows', 'eval-nightly.yml'),
  'utf8'
);

describe('eval-nightly workflow (issue #113)', () => {
  it('does not wrap the live eval step in continue-on-error', () => {
    expect(workflow).not.toContain('continue-on-error');
  });

  it('keeps the CLI exit code through the tee pipeline', () => {
    expect(workflow).toContain('set -o pipefail');
    expect(workflow).toContain('| tee artifacts/eval-full.log');
  });

  it('requires an explicit live model and judge model', () => {
    expect(workflow).toContain('--model ');
    expect(workflow).toContain('--judge-model ');
  });

  it('still uploads the JSON and log artifacts on failure', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('eval-full.json');
    expect(workflow).toContain('eval-full.log');
  });
});

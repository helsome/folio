#!/usr/bin/env node
// Folio release gate runner (spec §39, §69).
//
//   bun run release:check
//
// Enforces the hard release gates from docs/release-gates.md in order:
//   1. unit/integration tests (`bun test`)
//   2. typecheck (`bun run typecheck`)
//   3. build (`bun run build`)
//   4. electron e2e golden path, local provider (FINAGENT_AGENT_PROVIDER=local)
//   5. package (`bun run release:package` — DMG + SHA256SUMS.txt)
//   6. packaged smoke (`bun run test:package-smoke`)
//
// Exits non-zero on the first gate failure; a red run is NOT RELEASEABLE.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const electronRoot = join(repoRoot, 'apps', 'electron');

const GATES = [
  {
    name: 'unit/integration tests',
    command: 'bun',
    args: ['test'],
    cwd: repoRoot,
  },
  {
    name: 'typecheck',
    command: 'bun',
    args: ['run', 'typecheck'],
    cwd: repoRoot,
  },
  {
    name: 'build',
    command: 'bun',
    args: ['run', 'build'],
    cwd: repoRoot,
  },
  {
    name: 'electron e2e (local provider)',
    command: 'bun',
    args: ['run', 'test:e2e'],
    cwd: electronRoot,
    env: { FINAGENT_AGENT_PROVIDER: 'local' },
  },
  {
    name: 'package (DMG + checksums)',
    command: 'bun',
    args: ['run', 'release:package'],
    cwd: repoRoot,
  },
  {
    name: 'packaged smoke',
    command: 'bun',
    args: ['run', 'test:package-smoke'],
    cwd: electronRoot,
  },
  {
    name: 'fresh-install release e2e (packaged app)',
    command: 'bun',
    args: ['run', 'test:fresh-install'],
    cwd: electronRoot,
  },
];

let failures = 0;
const startedAt = Date.now();

GATES.forEach((gate, index) => {
  const label = `release:check ${index + 1}/${GATES.length} — ${gate.name}`;
  console.log(`\n=== ${label} ===`);

  const gateStartedAt = Date.now();
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(gate.env ?? {}) },
  });
  const elapsed = ((Date.now() - gateStartedAt) / 1000).toFixed(1);

  if (result.status !== 0) {
    failures += 1;
    console.error(`\nFAIL  ${gate.name} (exit ${result.status}, ${elapsed}s)`);
  } else {
    console.log(`\nPASS  ${gate.name} (${elapsed}s)`);
  }
});

const total = ((Date.now() - startedAt) / 1000).toFixed(1);

if (failures > 0) {
  console.error(`\nrelease:check FAILED — ${failures}/${GATES.length} gate(s) red. NOT RELEASEABLE. (${total}s)`);
  process.exit(1);
}

console.log(`\nrelease:check PASSED — all ${GATES.length} release gates green. (${total}s)`);

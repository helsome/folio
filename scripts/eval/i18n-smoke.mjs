#!/usr/bin/env bun
// i18n smoke run (spec §94).
//
// Runs the tiny zh-CN subset (folio-agent-v1-zh) in deterministic fixture
// mode, so the Eval Runner exercises the bilingual path (case locale 'zh-CN'
// → runtime language instruction, spec §37–38) without LLM credentials,
// network, or touching the en baseline.
//
//   bun scripts/eval/i18n-smoke.mjs
//
// Re-uses the existing run.ts CLI (`--smoke --dataset folio-agent-v1-zh
// --mode fixture`) with a throwaway store dir. Exits 0 on success, nonzero on
// infra error — same contract as eval:smoke. The committed en baseline
// (scripts/eval/ci-baselines) is fully untouched.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const runScript = join(here, 'run.ts');
const workdir = await mkdtemp(join(tmpdir(), 'folio-i18n-smoke-'));

try {
  const proc = Bun.spawn(
    ['bun', runScript, '--smoke', '--dataset', 'folio-agent-v1-zh', '--mode', 'fixture', '--store', workdir],
    { stdout: 'inherit', stderr: 'inherit', cwd: resolve(here, '..', '..') }
  );
  const code = await proc.exited;
  process.exitCode = code ?? 1;
} catch (error) {
  console.error('[i18n-smoke] failed to start eval run:', error);
  process.exitCode = 1;
} finally {
  await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
}

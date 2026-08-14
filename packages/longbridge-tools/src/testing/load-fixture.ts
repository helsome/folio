import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test-only fixture loader for the `longbridge-tools` package.
 *
 * Fixtures are REAL LongBridge CLI `--format json` output captured into
 * `fixtures/<name>.json` (see `fixtures/README.md` and `capture.sh`). They give
 * unit tests and downstream tool wrappers a deterministic ground truth without
 * touching the live CLI or the network.
 */

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Fixture names are plain filenames (no directory component, no traversal).
 * Allow letters, digits, `-`, `_`, and `.` so a name like `capital-flow` works.
 * Reject anything that could escape the fixtures directory.
 */
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeFixtureName(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || !SAFE_NAME_RE.test(name)) {
    throw new Error(`Unsafe fixture name: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Resolve the absolute path of a fixture file for the given extension. */
export function fixturePath(name: string, ext = 'json'): string {
  const safe = assertSafeFixtureName(name);
  return join(FIXTURES_DIR, `${safe}.${ext}`);
}

/** Read a fixture's raw file contents (utf-8). Throws if missing or unsafe. */
export function loadFixtureText(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

/** Read a fixture and parse it as JSON. */
export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(loadFixtureText(name)) as T;
}

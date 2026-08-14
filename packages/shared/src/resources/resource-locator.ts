import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves Folio's runtime resource paths in both dev and packaged modes.
 *
 * - Dev: everything resolves under the repository root, discovered from the
 *   location of this module (`import.meta.url`) — never from `process.cwd()` —
 *   so the app works no matter which directory it is launched from.
 * - Packaged: everything resolves under Electron's `process.resourcesPath`
 *   (`<app>.app/Contents/Resources`), where `extraResources` ships `skills/`
 *   and the bundled Pi extension.
 *
 * Shared code must not import Electron, so "packaged" is detected by a flag
 * the packaged main process sets (`FINAGENT_PACKAGED=1`, set only when
 * `app.isPackaged` is true) combined with `process.resourcesPath` actually
 * pointing at a directory whose name is `Resources`. In dev, Electron's own
 * `process.resourcesPath` also ends in `Resources`, so the env flag is the
 * discriminator; both conditions are required to avoid false positives.
 */

// resource-locator.ts -> resources -> src -> shared -> packages -> repo root.
const REPO_ROOT_OFFSET = 4;

function readResourcesPath(): string | undefined {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  return proc.resourcesPath;
}

function repoRootFromHere(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, ...new Array<string>(REPO_ROOT_OFFSET).fill('..'));
}

/** True when running inside a packaged Folio app (not the dev source tree). */
export function isPackaged(): boolean {
  const resourcesPath = readResourcesPath();
  return (
    process.env.FINAGENT_PACKAGED === '1' &&
    typeof resourcesPath === 'string' &&
    resourcesPath.length > 0 &&
    resourcesPath.endsWith('Resources')
  );
}

/** Root directory for runtime resources: repo root in dev, Resources dir when packaged. */
export function getRuntimeRoot(): string {
  return isPackaged() ? (readResourcesPath() as string) : repoRootFromHere();
}

/** Directory containing the vendored skills (SKILL.md packages). */
export function getSkillsDir(): string {
  return join(getRuntimeRoot(), 'skills');
}

/**
 * Entry file for the Pi extension.
 *
 * - Dev: the TypeScript source at `.pi/extensions/finagent/index.ts`.
 * - Packaged: the self-contained bundle shipped to `extensions/finagent/index.js`
 *   under `process.resourcesPath`.
 */
export function getPiExtensionEntry(): string {
  return isPackaged()
    ? join(getRuntimeRoot(), 'extensions', 'finagent', 'index.js')
    : join(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts');
}

/** Working directory for the Pi runtime spawn (extension paths resolve from here). */
export function getPiCwd(): string {
  return getRuntimeRoot();
}

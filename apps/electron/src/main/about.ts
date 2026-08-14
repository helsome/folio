import { app, ipcMain } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toIpcResult } from './kernelHost.ts';

export interface AboutInfo {
  version: string;
  channel: string;
  build: string;
}

/**
 * Release channel for this build. `folio.channel` in apps/electron/package.json
 * is the declared source of truth (`internal` | `beta` | `stable`); it is baked
 * into the packed app via extraMetadata and read here at runtime. `FINAGENT_CHANNEL`
 * overrides it (CI emits `internal` for unsigned builds).
 */
const DEFAULT_CHANNEL = 'beta';

function readFolioField(field: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
    const value = pkg?.folio?.[field];
    if (typeof value === 'string' && value.length > 0) return value;
  } catch {
    // Dev entry may point at src/main; fall through to env/default.
  }
  return undefined;
}

function readChannel(): string {
  return process.env.FINAGENT_CHANNEL ?? readFolioField('channel') ?? DEFAULT_CHANNEL;
}

function readBuildSha(): string {
  // CI bakes the exact git SHA via extraMetadata (`folio.buildSha`); a local or
  // dev build reports `dev`.
  return process.env.FINAGENT_BUILD_SHA ?? readFolioField('buildSha') ?? 'dev';
}

/**
 * Registers the `app:about` IPC handler returning `{version, channel, build}`.
 * Wired from `apps/electron/src/main/index.ts` (Lead-owned) via:
 *
 *   import { registerAboutIpc } from './about.ts';
 *   registerAboutIpc();
 */
export function registerAboutIpc(): void {
  ipcMain.handle('app:about', () =>
    toIpcResult<AboutInfo>(() => ({
      version: app.getVersion(),
      channel: readChannel(),
      build: readBuildSha(),
    }))
  );
}

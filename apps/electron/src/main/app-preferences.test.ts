import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'bun:test';
import { JsonFileStore } from '@finagent/shared';
import { createAppPreferencesService } from './app-preferences.ts';

function makeService(systemLocale = 'en-US') {
  const dir = mkdtempSync(join(tmpdir(), 'app-prefs-'));
  const service = createAppPreferencesService(new JsonFileStore(dir), () => systemLocale);
  return { service, dir };
}

describe('app preferences (main-owned locale persistence, spec §14–16, §89)', () => {
  it('defaults to system preference with effective locale resolved from OS', async () => {
    const { service } = makeService('zh-Hans-CN');
    const snap = await service.get();
    expect(snap.preference).toBe('system');
    expect(snap.systemLocale).toBe('zh-Hans-CN');
    expect(snap.effectiveLocale).toBe('zh-CN');
  });

  it('resolves system to en-US for non-Chinese OS locales', async () => {
    const { service } = makeService('en-US');
    const snap = await service.get();
    expect(snap.effectiveLocale).toBe('en-US');
    const fr = await makeService('fr-FR').service.get();
    expect(fr.effectiveLocale).toBe('en-US');
  });

  it('pins the locale and persists across service instances (restart-equivalent)', async () => {
    const { service, dir } = makeService('en-US');
    const pinned = await service.update('zh-CN');
    expect(pinned.preference).toBe('zh-CN');
    expect(pinned.effectiveLocale).toBe('zh-CN');

    // "Restart": a new service instance (same store dir) reads the file back.
    const reopened = createAppPreferencesService(new JsonFileStore(dir), () => 'en-US');
    const snap = await reopened.get();
    expect(snap.preference).toBe('zh-CN');
    expect(snap.effectiveLocale).toBe('zh-CN');
  });

  it('keeps system resolution for a pinned unsupported value (silent fallback)', async () => {
    const { service, dir } = makeService('fr-FR');
    // Directly corrupt the stored file the way a tamper might.
    await new JsonFileStore(dir).write('app-preferences.json', { locale: 'ja-JP' });
    const snap = await service.get();
    expect(snap.preference).toBe('system');
    expect(snap.effectiveLocale).toBe('en-US');
  });

  it('rejects invalid locale input with a stable error code', async () => {
    const { service } = makeService();
    // @ts-expect-error update guards against untrusted input
    await expect(service.update('fr')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

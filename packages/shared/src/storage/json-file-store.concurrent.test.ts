import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore } from './json-file-store.ts';

async function withStore(work: (store: JsonFileStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'folio-json-file-store-'));
  try {
    await work(new JsonFileStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function payload(id: number) {
  return { id, body: `${id}:`.repeat(256) };
}

describe('JsonFileStore concurrent writes', () => {
  it('allows concurrent writers to the same file', async () => {
    await withStore(async (store, root) => {
      const writes = Array.from({ length: 32 }, (_, id) => store.write('state.json', payload(id)));

      await Promise.all(writes);

      const result = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as ReturnType<typeof payload>;
      expect(result.id).toBeGreaterThanOrEqual(0);
      expect(result.id).toBeLessThan(32);
      expect(result.body).toBe(payload(result.id).body);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });
  });

  it('supports concurrent writers from separate store instances', async () => {
    await withStore(async (_store, root) => {
      const stores = [new JsonFileStore(root), new JsonFileStore(root)];
      const writes = Array.from({ length: 32 }, (_, id) => stores[id % stores.length]!.write('state.json', payload(id)));

      await Promise.all(writes);

      const result = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as ReturnType<typeof payload>;
      expect(result.id).toBeGreaterThanOrEqual(0);
      expect(result.id).toBeLessThan(32);
      expect(result.body).toBe(payload(result.id).body);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });
  });

  it('cleans up its temporary file when publishing fails', async () => {
    await withStore(async (store, root) => {
      await mkdir(join(root, 'occupied'));

      let error: unknown;
      try {
        await store.write('occupied', { ok: true });
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      expect((await readdir(join(root, 'occupied')))).toEqual([]);
    });
  });
});

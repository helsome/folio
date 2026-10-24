import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore } from './json-file-store.ts';

describe('JsonFileStore serialization', () => {
  const unsupportedValues: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['function', () => 'not JSON'],
    ['symbol', Symbol('not JSON')],
    ['toJSON returning undefined', { toJSON: () => undefined }],
  ];

  for (const [name, value] of unsupportedValues) {
    it(`rejects ${name} without replacing the last readable snapshot`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'folio-json-serialization-'));
      try {
        const store = new JsonFileStore(root);
        const snapshot = { messages: [{ role: 'user', content: 'keep this message' }] };
        await store.write('state.json', snapshot);
        const original = await readFile(join(root, 'state.json'), 'utf8');

        await expect(store.write('state.json', value)).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });

        expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(original);
        expect(await new JsonFileStore(root).read<typeof snapshot | null>('state.json', null)).toEqual(snapshot);
        expect(await readdir(root)).toEqual(['state.json']);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  it('does not create directories or files for an unsupported first write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folio-json-serialization-'));
    try {
      const store = new JsonFileStore(root);
      await expect(store.write('nested/state.json', undefined)).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('continues to round-trip valid falsy JSON values and custom serialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folio-json-serialization-'));
    try {
      const store = new JsonFileStore(root);
      for (const value of [null, false, 0, '']) {
        await store.write('state.json', value);
        expect(await new JsonFileStore(root).read<unknown>('state.json', 'missing')).toBe(value);
      }
      await store.write('state.json', { toJSON: () => ({ saved: true }) });
      expect(await store.read<{ saved: boolean } | null>('state.json', null)).toEqual({ saved: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

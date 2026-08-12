import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createCodeError } from '../agent/errors.ts';

/**
 * Minimal atomic JSON persistence backed by a directory of files.
 *
 * Writes go to `<file>.tmp` first and are renamed into place, so a crash
 * mid-write never leaves a truncated file. This is the V1 storage substrate;
 * repositories can later be swapped for SQLite without touching callers.
 */
export class JsonFileStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  resolve(file: string): string {
    return join(this.rootDir, file);
  }

  async read<T>(file: string, fallback: T): Promise<T> {
    try {
      const contents = await readFile(join(this.rootDir, file), 'utf8');
      return JSON.parse(contents) as T;
    } catch (error) {
      if (
        error instanceof Error &&
        typeof (error as NodeJS.ErrnoException).code === 'string' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return fallback;
      }
      throw createCodeError(
        'STORAGE_READ_FAILED',
        `Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async write(file: string, data: unknown): Promise<void> {
    const target = join(this.rootDir, file);
    const tmp = `${target}.tmp`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(tmp, target);
    } catch (error) {
      throw createCodeError(
        'STORAGE_WRITE_FAILED',
        `Failed to write ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async remove(file: string): Promise<void> {
    try {
      await unlink(join(this.rootDir, file));
    } catch (error) {
      if (
        error instanceof Error &&
        typeof (error as NodeJS.ErrnoException).code === 'string' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}

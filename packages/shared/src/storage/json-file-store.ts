import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createCodeError } from '../agent/errors.ts';

const publishLocks = new Map<string, Promise<void>>();

/**
 * Serialize only the final replacement for a target. Temporary files can be
 * prepared concurrently, while Windows gets a deterministic replacement
 * order when several store instances publish the same target at once.
 */
async function publish(target: string, tmp: string): Promise<void> {
  const previous = publishLocks.get(target) ?? Promise.resolve();
  let current: Promise<void>;
  current = previous
    .catch(() => undefined)
    .then(() => rename(tmp, target));
  publishLocks.set(target, current);
  try {
    await current;
  } finally {
    if (publishLocks.get(target) === current) publishLocks.delete(target);
  }
}

/**
 * Minimal atomic JSON persistence backed by a directory of files.
 *
 * Writes go to an exclusively created, per-write temporary file in the target
 * directory and are renamed into place, so concurrent writers never share a
 * staging file. This is the V1 storage substrate; repositories can later be
 * swapped for SQLite without touching callers.
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
    const tmp = `${target}.${randomUUID()}.tmp`;
    let ownsTemp = false;
    try {
      const contents = `${JSON.stringify(data, null, 2)}\n`;
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(tmp, 'wx', 0o600);
      ownsTemp = true;
      try {
        await handle.writeFile(contents, 'utf8');
      } finally {
        await handle.close();
      }
      await publish(target, tmp);
      ownsTemp = false;
    } catch (error) {
      throw createCodeError(
        'STORAGE_WRITE_FAILED',
        `Failed to write ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (ownsTemp) {
        // Only clean up this writer's file; never remove the last good target
        // or another writer's staging file. Preserve the original write error.
        await unlink(tmp).catch((cleanupError: unknown) => {
          const code = (cleanupError as NodeJS.ErrnoException)?.code;
          if (code !== 'ENOENT') {
            console.warn('[JsonFileStore] Temporary-file cleanup failed:', code ?? 'UNKNOWN');
          }
        });
      }
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

/**
 * Serialize read-modify-write cycles per target file, across store
 * instances.
 *
 * Every repository in this directory reads a whole JSON file, edits it and
 * writes it back, so two overlapping updates would otherwise both base
 * their write on the same snapshot and silently drop each other's changes
 * (issue #145 for `ConnectionStore`, and the session-scoped repositories
 * here). `JsonFileStore` only serializes the final replacement, which
 * leaves the window between `read` and `write` uncovered — hence a lock at
 * this layer, keyed by the resolved target path so that separate store
 * instances over the same directory share it.
 *
 * The key is the absolute target (`store.resolve(file)`), never the bare
 * relative name: two `JsonFileStore`s rooted at different directories may
 * legitimately use the same relative name at the same time.
 */
const writeLocks = new Map<string, Promise<unknown>>();

export async function withWriteLock<T>(target: string, task: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(target) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  writeLocks.set(target, current);
  try {
    return await current;
  } finally {
    if (writeLocks.get(target) === current) writeLocks.delete(target);
  }
}

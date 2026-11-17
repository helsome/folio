import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { InvestmentThesis, ThesisImpact } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { withWriteLock } from '../storage/write-lock.ts';
import { createCodeError } from '../agent/errors.ts';

const INDEX_FILE = 'index.json';

function fileLockKey(store: JsonFileStore, file: string): string {
  const path = resolve(store.resolve(file));
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

// Thesis ids are opaque names, not relative paths — the same file-name contract
// the research repositories keep at their store boundary. `JsonFileStore` only
// `join()`s the name onto the root, so an unchecked id such as `../x` would
// read and write outside `<storageDir>`.
const thesisFile = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw createCodeError('INVALID_ARGUMENT', 'Invalid thesis id.');
  }
  return `${id}.json`;
};

const impactFile = (thesisId: unknown): string => {
  if (typeof thesisId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(thesisId)) {
    throw createCodeError('INVALID_ARGUMENT', 'Invalid thesis id.');
  }
  return `impacts/${thesisId}.json`;
};

export interface ThesisIndexEntry {
  symbol: string;
  updatedAt: number;
}

export interface ThesisRepositoryOptions {
  /** `<userData>/thesis` — the directory the kernel provides at integration. */
  storageDir: string;
  idGen?: () => string;
}

/**
 * Durable InvestmentThesis store: `<storageDir>/index.json` holds the
 * id → { symbol, updatedAt } index; one `<storageDir>/<id>.json` file holds
 * each thesis body. Both repositories in this module share the same
 * `<userData>/thesis` directory (impacts live under `impacts/`).
 */
export class ThesisRepository {
  private readonly store: JsonFileStore;
  readonly idGen: () => string;

  constructor(options: ThesisRepositoryOptions) {
    this.store = new JsonFileStore(options.storageDir);
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  private readIndex(): Promise<Record<string, ThesisIndexEntry>> {
    return this.store.read<Record<string, ThesisIndexEntry>>(INDEX_FILE, {});
  }

  private writeIndex(index: Record<string, ThesisIndexEntry>): Promise<void> {
    return this.store.write(INDEX_FILE, index);
  }

  /** Upsert a thesis (body + index entry). */
  async save(thesis: InvestmentThesis): Promise<InvestmentThesis> {
    const file = thesisFile(thesis.id);
    // The body shares the index lock: an overlapping delete must not remove
    // a saved body before its index entry is published (or vice versa).
    return withWriteLock(fileLockKey(this.store, INDEX_FILE), async () => {
      await this.store.write(file, thesis);
      const index = await this.readIndex();
      index[thesis.id] = { symbol: thesis.symbol, updatedAt: thesis.updatedAt };
      await this.writeIndex(index);
      return thesis;
    });
  }

  async get(id: string): Promise<InvestmentThesis | undefined> {
    return this.store.read<InvestmentThesis | undefined>(thesisFile(id), undefined);
  }

  /** Theses for a symbol, most-recently-updated first. */
  async getBySymbol(symbol: string): Promise<InvestmentThesis[]> {
    const index = await this.readIndex();
    const ids = Object.entries(index)
      .filter(([, entry]) => entry.symbol === symbol)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .map(([id]) => id);
    return this.resolveAll(ids);
  }

  async list(): Promise<InvestmentThesis[]> {
    const index = await this.readIndex();
    const ids = Object.entries(index)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .map(([id]) => id);
    return this.resolveAll(ids);
  }

  async delete(id: string): Promise<void> {
    const file = thesisFile(id);
    await withWriteLock(fileLockKey(this.store, INDEX_FILE), async () => {
      await this.store.remove(file);
      const index = await this.readIndex();
      if (id in index) {
        delete index[id];
        await this.writeIndex(index);
      }
    });
  }

  private async resolveAll(ids: string[]): Promise<InvestmentThesis[]> {
    const theses: InvestmentThesis[] = [];
    for (const id of ids) {
      const thesis = await this.get(id);
      if (thesis) theses.push(thesis);
    }
    return theses;
  }
}

export interface ThesisImpactRepositoryOptions {
  /** `<userData>/thesis` (same root as the thesis repository). */
  storageDir: string;
  idGen?: () => string;
}

/**
 * Append-only impact history per thesis: `<storageDir>/impacts/<thesisId>.json`.
 * Thesis ids are opaque names, not relative paths (see `impactFile`).
 */
export class ThesisImpactRepository {
  private readonly store: JsonFileStore;
  readonly idGen: () => string;

  constructor(options: ThesisImpactRepositoryOptions) {
    this.store = new JsonFileStore(options.storageDir);
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  async append(impact: ThesisImpact): Promise<void> {
    const file = impactFile(impact.thesisId);
    await withWriteLock(fileLockKey(this.store, file), async () => {
      const existing = await this.store.read<ThesisImpact[]>(file, []);
      existing.push(impact);
      await this.store.write(file, existing);
    });
  }

  async list(thesisId: string): Promise<ThesisImpact[]> {
    return this.store.read<ThesisImpact[]>(impactFile(thesisId), []);
  }
}

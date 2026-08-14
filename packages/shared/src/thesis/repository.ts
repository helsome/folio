import { randomUUID } from 'node:crypto';
import type { InvestmentThesis, ThesisImpact } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';

const INDEX_FILE = 'index.json';

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
    await this.store.write(`${thesis.id}.json`, thesis);
    const index = await this.readIndex();
    index[thesis.id] = { symbol: thesis.symbol, updatedAt: thesis.updatedAt };
    await this.writeIndex(index);
    return thesis;
  }

  async get(id: string): Promise<InvestmentThesis | undefined> {
    return this.store.read<InvestmentThesis | undefined>(`${id}.json`, undefined);
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
    await this.store.remove(`${id}.json`);
    const index = await this.readIndex();
    if (id in index) {
      delete index[id];
      await this.writeIndex(index);
    }
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
 */
export class ThesisImpactRepository {
  private readonly store: JsonFileStore;
  readonly idGen: () => string;

  constructor(options: ThesisImpactRepositoryOptions) {
    this.store = new JsonFileStore(options.storageDir);
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  private path(thesisId: string): string {
    return `impacts/${thesisId}.json`;
  }

  async append(impact: ThesisImpact): Promise<void> {
    const existing = await this.store.read<ThesisImpact[]>(this.path(impact.thesisId), []);
    existing.push(impact);
    await this.store.write(this.path(impact.thesisId), existing);
  }

  async list(thesisId: string): Promise<ThesisImpact[]> {
    return this.store.read<ThesisImpact[]>(this.path(thesisId), []);
  }
}

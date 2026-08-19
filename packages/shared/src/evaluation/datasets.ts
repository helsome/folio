// Dataset resolution (spec §22-26).
//
// The embedded benchmark ships with the app; user datasets load from the
// evaluation datasets directory. Datasets are versioned; changing a case
// means a new version, never silent mutation (§25).
import type { EvaluationDataset } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

export interface DatasetCatalog {
  list(): Promise<EvaluationDataset[]>;
  get(id: string): Promise<EvaluationDataset | undefined>;
}

/** Embedded dataset registry (bundled benchmark v1 lives at datasets/index.ts). */
export interface EmbeddedDataset {
  id: string;
  version: string;
  load: () => EvaluationDataset;
}

export class EmbeddedDatasetCatalog implements DatasetCatalog {
  private readonly embedded: EmbeddedDataset[];

  constructor(embedded: EmbeddedDataset[]) {
    this.embedded = embedded;
  }

  async list(): Promise<EvaluationDataset[]> {
    return this.embedded.map((entry) => entry.load());
  }

  async get(id: string): Promise<EvaluationDataset | undefined> {
    const entry = this.embedded.find((candidate) => candidate.id === id);
    return entry?.load();
  }
}

/** User-authored datasets persisted under the eval store (privacy-cleaned). */
export class UserDatasetCatalog implements DatasetCatalog {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async list(): Promise<EvaluationDataset[]> {
    return this.store.read<EvaluationDataset[]>('evaluation/datasets.json', []);
  }

  async get(id: string): Promise<EvaluationDataset | undefined> {
    const datasets = await this.list();
    return datasets.find((dataset) => dataset.id === id);
  }

  async upsert(dataset: EvaluationDataset): Promise<void> {
    const datasets = await this.list();
    const index = datasets.findIndex((entry) => entry.id === dataset.id);
    if (index >= 0) {
      datasets[index] = dataset;
    } else {
      datasets.push(dataset);
    }
    await this.store.write('evaluation/datasets.json', datasets);
  }
}

/** Composite catalog: embedded first (same id wins), then user datasets. */
export class CompositeDatasetCatalog implements DatasetCatalog {
  private readonly embedded: EmbeddedDatasetCatalog;
  private readonly user: UserDatasetCatalog;

  constructor(
    embedded: EmbeddedDatasetCatalog,
    user: UserDatasetCatalog,
  ) {
    this.embedded = embedded;
    this.user = user;
  }

  async list(): Promise<EvaluationDataset[]> {
    const embedded = await this.embedded.list();
    const user = await this.user.list();
    const userIds = new Set(user.map((dataset) => dataset.id));
    return [...embedded.filter((dataset) => !userIds.has(dataset.id)), ...user];
  }

  async get(id: string): Promise<EvaluationDataset | undefined> {
    return (await this.embedded.get(id)) ?? (await this.user.get(id));
  }
}
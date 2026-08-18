// Embedded benchmark datasets (spec §22). Add new datasets here to ship with the app.
import type { EmbeddedDataset } from '../datasets.ts';
import { folioAgentV1Dataset } from './folio-agent-v1.ts';

export const embeddedDatasets: EmbeddedDataset[] = [
  {
    id: 'folio-agent-v1',
    version: '1.0.0',
    load: () => folioAgentV1Dataset,
  },
];
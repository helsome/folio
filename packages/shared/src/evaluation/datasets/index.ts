// Embedded benchmark datasets (spec §22). Add new datasets here to ship with the app.
import type { EmbeddedDataset } from '../datasets.ts';
import { folioAgentV1Dataset } from './folio-agent-v1.ts';
import { folioAgentV1ZhDataset } from './folio-agent-v1-zh.ts';

export const embeddedDatasets: EmbeddedDataset[] = [
  {
    id: 'folio-agent-v1',
    version: '1.0.0',
    load: () => folioAgentV1Dataset,
  },
  {
    id: 'folio-agent-v1-zh',
    version: '1.0.0',
    load: () => folioAgentV1ZhDataset,
  },
];

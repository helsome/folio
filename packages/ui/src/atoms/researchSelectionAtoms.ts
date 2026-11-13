import { persistedAtom } from '../lib/persistedPrefs';

export interface ResearchSelection {
  symbol: string;
  reportId: string;
}

export const researchSelectionAtom = persistedAtom<ResearchSelection | null>('researchSelection', null);

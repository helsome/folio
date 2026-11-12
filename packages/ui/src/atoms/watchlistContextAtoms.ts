import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { activeSessionIdAtom } from './sessionAtoms';
import { watchlistAtom } from './quoteAtoms';

export const watchlistContextEnabledAtomFamily = atomFamily((_sessionId: string) => atom(false));

export const selectedWatchlistSymbolsAtom = atom<string[] | undefined>((get) => {
  const sessionId = get(activeSessionIdAtom);
  if (!sessionId || !get(watchlistContextEnabledAtomFamily(sessionId))) return undefined;
  return [...get(watchlistAtom)];
});

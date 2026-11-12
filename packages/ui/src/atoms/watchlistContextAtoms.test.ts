import { expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { activeSessionIdAtom } from './sessionAtoms';
import { watchlistAtom } from './quoteAtoms';
import { selectedWatchlistSymbolsAtom, watchlistContextEnabledAtomFamily } from './watchlistContextAtoms';

it('shares a copied watchlist only in the conversation that explicitly opted in', () => {
  const store = createStore();
  store.set(activeSessionIdAtom, 'selected');
  store.set(watchlistAtom, ['AAPL.US', 'MSFT.US']);
  expect(store.get(selectedWatchlistSymbolsAtom)).toBeUndefined();
  store.set(watchlistContextEnabledAtomFamily('selected'), true);
  const captured = store.get(selectedWatchlistSymbolsAtom);
  expect(captured).toEqual(['AAPL.US', 'MSFT.US']);
  store.set(watchlistAtom, ['NVDA.US']);
  expect(captured).toEqual(['AAPL.US', 'MSFT.US']);
  store.set(activeSessionIdAtom, 'other');
  expect(store.get(selectedWatchlistSymbolsAtom)).toBeUndefined();
});

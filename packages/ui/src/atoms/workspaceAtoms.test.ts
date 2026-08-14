import { createStore } from 'jotai';
import { describe, expect, it } from 'bun:test';
import {
  activeSymbolAtom,
  activeViewAtom,
  selectedPositionAtom,
  workspaceContextAtom,
  navSectionAtom,
  agentPanelVisibleAtom,
} from './workspaceAtoms';
import { compareSymbolsAtom } from './compareAtoms';

describe('workspace atoms', () => {
  it('derives WorkspaceContext from active symbol and view', () => {
    const store = createStore();
    store.set(activeSymbolAtom, 'NVDA.US');
    store.set(activeViewAtom, 'chart');

    expect(store.get(workspaceContextAtom)).toEqual({
      activeSymbol: 'NVDA.US',
      activeView: 'chart',
    });
  });

  it('omits unset fields from the context', () => {
    const store = createStore();
    expect(store.get(workspaceContextAtom)).toEqual({
      activeView: 'overview',
    });

    store.set(selectedPositionAtom, 'pos-1');
    expect(store.get(workspaceContextAtom)).toEqual({
      activeView: 'overview',
      selectedPosition: 'pos-1',
    });
  });

  it('includes comparisonSymbols from the compare workspace when set', () => {
    const store = createStore();
    expect(store.get(workspaceContextAtom)).toEqual({ activeView: 'overview' });

    store.set(compareSymbolsAtom, ['AAPL.US', 'MSFT.US']);
    expect(store.get(workspaceContextAtom)).toEqual({
      activeView: 'overview',
      comparisonSymbols: ['AAPL.US', 'MSFT.US'],
    });
  });

  it('nav and panel visibility atoms have defaults', () => {
    const store = createStore();
    expect(store.get(navSectionAtom)).toBe('sessions');
    expect(store.get(agentPanelVisibleAtom)).toBe(true);
    store.set(agentPanelVisibleAtom, false);
    expect(store.get(agentPanelVisibleAtom)).toBe(false);
  });
});

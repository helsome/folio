import type { Comparison } from '@finagent/core';

/**
 * Defensive compare client. The real channel (`window.electronAPI.compare.*`)
 * is wired by the Lead at integration; until then the loader degrades to `null`
 * and the Compare workspace renders its empty state.
 */

interface CompareElectronApi {
  compare?: {
    build?: (symbols: string[]) => Promise<Comparison>;
  };
}

export async function loadComparison(symbols: string[]): Promise<Comparison | null> {
  try {
    const api = (window as { electronAPI?: CompareElectronApi }).electronAPI;
    const loader = api?.compare?.build;
    if (typeof loader !== 'function') return null;
    return await loader(symbols);
  } catch {
    return null;
  }
}

import type { ImportSource, ManualPortfolio, PortfolioImportDraft } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';

/**
 * Defensive loader for the Portfolio Import channels (spec §43–49).
 *
 * Parsing runs in the MAIN process (`@finagent/shared/portfolio-import` — the
 * renderer cannot import shared packages), so `import:parse` ships the raw
 * text over IPC and receives a draft back. Confirmation persists the draft as
 * a manual portfolio; listing returns every manual portfolio. Every loader
 * degrades gracefully (null / []) when the channel is not wired yet.
 */

export interface PortfolioImportParseInput {
  source: ImportSource;
  text: string;
}

export interface PortfolioImportConfirmInput {
  draft: PortfolioImportDraft;
  name: string;
}

/** The preload surface the main process exposes (wired by the Lead). */
export interface PortfolioImportElectronApi {
  portfolioImport?: {
    parse?: (input: PortfolioImportParseInput) => Promise<unknown>;
    confirm?: (input: PortfolioImportConfirmInput) => Promise<unknown>;
    listManual?: () => Promise<unknown>;
  };
}

/** Parse import text in the main process; null when the channel is absent. */
export async function parsePortfolioImport(
  source: ImportSource,
  text: string
): Promise<PortfolioImportDraft | null> {
  try {
    const api = (window as { electronAPI?: PortfolioImportElectronApi }).electronAPI;
    const parse = api?.portfolioImport?.parse;
    if (typeof parse !== 'function') return null;
    return unwrapIpcResult<PortfolioImportDraft>(await parse({ source, text }));
  } catch {
    return null;
  }
}

/** Confirm a draft in the main process (persists a manual portfolio). */
export async function confirmPortfolioImport(
  draft: PortfolioImportDraft,
  name: string
): Promise<ManualPortfolio | null> {
  try {
    const api = (window as { electronAPI?: PortfolioImportElectronApi }).electronAPI;
    const confirm = api?.portfolioImport?.confirm;
    if (typeof confirm !== 'function') return null;
    return unwrapIpcResult<ManualPortfolio>(await confirm({ draft, name }));
  } catch {
    return null;
  }
}

/** List manual portfolios; [] when the channel is absent or fails. */
export async function listManualPortfolios(): Promise<ManualPortfolio[]> {
  try {
    const api = (window as { electronAPI?: PortfolioImportElectronApi }).electronAPI;
    const listManual = api?.portfolioImport?.listManual;
    if (typeof listManual !== 'function') return [];
    return unwrapIpcResult<ManualPortfolio[]>(await listManual()) ?? [];
  } catch {
    return [];
  }
}

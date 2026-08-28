import { compareSymbolsAtom } from './compareAtoms';
import { atom } from 'jotai';
import type { WorkspaceContext, WorkspaceView } from '@finagent/core';
import { persistedAtom } from '../lib/persistedPrefs';

// ---------------------------------------------------------------------------
// Workspace context: the current financial-object focus of the UI.
//
// Deliberately separate from Agent Session state. `activeSymbol` is the single
// global source of truth for which security the workspace (Security Header,
// Chart, Overview, Financials, News, Agent Panel context) is looking at.
// ---------------------------------------------------------------------------

/** The security the workspace is currently focused on (e.g. "NVDA.US"). */
export const activeSymbolAtom = atom<string | null>(null);

/** Which workspace view is visible: security views or app sections. */
export const activeViewAtom = atom<WorkspaceView>('overview');

/** Selected portfolio position (portfolio view). */
export const selectedPositionAtom = atom<string | null>(null);

/** Sidebar navigation section (app-level views). */
export type NavSection =
  | 'sessions'
  | 'watchlist'
  | 'portfolio'
  | 'alerts'
  | 'skills'
  | 'settings'
  // Folio V3 sections — wired by the Lead at integration; reserved here so
  // feature agents never race on this union.
  | 'research'
  | 'thesis'
  | 'compare'
  // Folio V4 "Today" dashboard (spec §31–32) — mounted by the Lead.
  | 'today'
  // Folio V5 "Discover" (spec §4–5) — mounted by the Lead.
  | 'discover'
  // Folio V7 Evaluation Center (spec §61–68) — mounted by the Evaluation UI agent.
  | 'evaluation'
  // Stitch portfolio surfaces: upcoming events and local profile/security.
  | 'events'
  | 'profile';

export const navSectionAtom = persistedAtom<NavSection>('navSection', 'sessions');

/** Whether the Agent Panel is visible (collapse/expand in the shell). */
export const agentPanelVisibleAtom = persistedAtom<boolean>('agentPanelVisible', true);
/** Active tab within the Settings section. */
export type SettingsTab =
  | 'general'
  | 'llm'
  | 'connections'
  | 'skills'
  | 'diagnostics'
  | 'performance'
  // Folio V7 agent evaluation settings (spec §61–63).
  | 'evaluation';

/** Which Settings tab is selected (drives SettingsView and the ErrorBoundary fallback). */
export const settingsTabAtom = atom<SettingsTab>('general');


/** Derived WorkspaceContext passed to agent runs and shared by all views. */
export const workspaceContextAtom = atom<WorkspaceContext>((get) => {
  const activeSymbol = get(activeSymbolAtom);
  const activeView = get(activeViewAtom);
  const selectedPosition = get(selectedPositionAtom);
  const comparisonSymbols = get(compareSymbolsAtom);
  return {
    ...(activeSymbol ? { activeSymbol } : {}),
    ...(activeView ? { activeView } : {}),
    ...(selectedPosition ? { selectedPosition } : {}),
    ...(comparisonSymbols.length > 0 ? { comparisonSymbols } : {}),
  };
});

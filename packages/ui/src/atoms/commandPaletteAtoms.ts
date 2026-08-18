import { atom } from 'jotai'
import type { NavSection } from './workspaceAtoms'

/**
 * Command Palette state + pure command logic (spec §33).
 *
 * `commandPaletteOpenAtom` is the single toggle the global hotkey and the
 * palette modal share. The command list is built and filtered by pure
 * functions here so the matching + keyboard-navigation logic is unit-testable
 * without a DOM or a React tree.
 */

/** Whether the ⌘K / Ctrl+K palette is open. */
export const commandPaletteOpenAtom = atom<boolean>(false)

export type PaletteCommandKind = 'symbol' | 'navigation' | 'action'

/** A single selectable palette entry. */
export interface PaletteCommand {
  id: string
  kind: PaletteCommandKind
  label: string
  hint?: string
  /** Extra searchable terms beyond the label. */
  keywords?: string[]
  /** For symbol commands: the symbol to focus. */
  symbol?: string
  /** For navigation commands: the app section to open. */
  section?: NavSection
  /** For action commands: which action to run. */
  action?: 'research-current' | 'open-connections'
}

/** Localized strings used to render palette entries (§70). */
export interface PaletteLabels {
  openSymbolHint: string
  openSymbol: (symbol: string) => string
  goToHint: string
  startResearch: (activeSymbol: string | null) => string
  quickActionHint: string
  openConnections: string
  quickActionSettingsHint: string
  navigation: Partial<Record<NavSection, string>>
}

export interface PaletteCommandInput {
  query: string
  watchlist: string[]
  activeSymbol: string | null
  /** Localizer for command labels. When absent, English aliases are used. */
  labels?: PaletteLabels
}

/** The app sections reachable from the palette, in sidebar order. */
export const NAVIGATION_COMMANDS: Array<{ section: NavSection; label: string }> = [
  { section: 'portfolio', label: 'Portfolio' },
  { section: 'research', label: 'Research' },
  { section: 'thesis', label: 'Thesis' },
  { section: 'compare', label: 'Compare' },
  { section: 'alerts', label: 'Alerts' },
  { section: 'skills', label: 'Skills' },
  { section: 'evaluation', label: 'Evaluation' },
  { section: 'settings', label: 'Settings' },
]

const NAVIGATION_LABEL: Record<NavSection, string> = Object.fromEntries(
  NAVIGATION_COMMANDS.map((n) => [n.section, n.label]),
) as Record<NavSection, string>

const DEFAULT_LABELS: PaletteLabels = {
  openSymbolHint: 'Open symbol',
  openSymbol: (symbol) => `Open ${symbol}`,
  goToHint: 'Go to',
  startResearch: (symbol) =>
    symbol != null ? `Start research on ${symbol}` : 'Start research on current symbol',
  quickActionHint: 'Quick action',
  openConnections: 'Open Connections',
  quickActionSettingsHint: 'Quick action · Settings',
  navigation: NAVIGATION_LABEL,
}

/** Fully-qualified `CODE.MARKET` symbol (same markets as the Watchlist). */
const SYMBOL_PATTERN = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/

/**
 * Normalize a fully-qualified free-text symbol (`CODE.MARKET`) to uppercase,
 * or return `null` when the input is not fully-qualified. Free-text open
 * requires an explicit market suffix so a bare/partial ticker stays a
 * watchlist search and never collides with navigation labels ("Portfolio").
 */
export function normalizeSymbolInput(raw: string): string | null {
  const candidate = raw.trim().toUpperCase()
  return SYMBOL_PATTERN.test(candidate) ? candidate : null
}

/**
 * Watchlist symbols matching the query, case-insensitive; prefix matches rank
 * ahead of substring matches, then alphabetical.
 */
export function matchWatchlistSymbols(query: string, watchlist: string[]): string[] {
  const needle = query.trim().toUpperCase()
  if (needle === '') return []
  return watchlist
    .filter((symbol) => symbol.toUpperCase().includes(needle))
    .slice()
    .sort((a, b) => {
      const aPrefix = a.toUpperCase().startsWith(needle) ? 0 : 1
      const bPrefix = b.toUpperCase().startsWith(needle) ? 0 : 1
      if (aPrefix !== bPrefix) return aPrefix - bPrefix
      return a.localeCompare(b)
    })
}

/** Score a command against a (non-empty, lower-cased) query. */
function matchScore(needle: string, command: PaletteCommand): number {
  let best = 0
  const terms: string[] = [command.label.toLowerCase()]
  if (command.symbol) terms.push(command.symbol.toLowerCase())
  for (const keyword of command.keywords ?? []) terms.push(keyword.toLowerCase())

  // Substring matching on 1–2 char queries is too noisy ("ts" → "alerTS");
  // short queries match on exact/prefix only.
  const allowSubstring = needle.length >= 3
  for (const term of terms) {
    if (term === needle) best = Math.max(best, 100)
    else if (term.startsWith(needle)) best = Math.max(best, 80)
    else if (allowSubstring && term.includes(needle)) best = Math.max(best, 50)
  }
  return best
}

/**
 * Filter commands to those matching the query, best match first (stable within
 * a score). An empty query returns the list unchanged.
 */
export function filterCommands(query: string, commands: PaletteCommand[]): PaletteCommand[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return commands
  return commands
    .map((command) => ({ command, score: matchScore(needle, command) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command)
}

/**
 * Build the full, query-filtered command list for a render: watchlist symbol
 * matches + free-text symbol, then navigation sections, then quick actions.
 */
export function buildPaletteCommands(input: PaletteCommandInput): PaletteCommand[] {
  const { query, watchlist, activeSymbol, labels } = input
  const L = labels ?? DEFAULT_LABELS
  const needle = query.trim()
  const commands: PaletteCommand[] = []

  if (needle !== '') {
    const matches = matchWatchlistSymbols(needle, watchlist)
    for (const symbol of matches) {
      commands.push({ id: `symbol:${symbol}`, kind: 'symbol', label: symbol, hint: L.openSymbolHint, symbol })
    }
    const freeText = normalizeSymbolInput(needle)
    if (freeText != null && !watchlist.includes(freeText)) {
      commands.push({ id: `symbol:${freeText}`, kind: 'symbol', label: L.openSymbol(freeText), hint: L.openSymbolHint, symbol: freeText })
    }
  }

  for (const { section, label: enLabel } of NAVIGATION_COMMANDS) {
    // English alias stays a keyword for best-effort search in non-English UIs (§70).
    const localized = L.navigation[section]
    commands.push({
      id: `nav:${section}`,
      kind: 'navigation',
      label: localized ?? enLabel,
      hint: L.goToHint,
      keywords: localized ? [enLabel] : undefined,
      section,
    })
  }

  commands.push({
    id: 'action:research-current',
    kind: 'action',
    label: L.startResearch(activeSymbol),
    hint: L.quickActionHint,
    action: 'research-current',
  })
  commands.push({
    id: 'action:open-connections',
    kind: 'action',
    label: L.openConnections,
    hint: L.quickActionSettingsHint,
    action: 'open-connections',
  })

  return filterCommands(needle, commands)
}

/**
 * Move the selected index by `delta` with wrap-around. `count <= 0` yields 0.
 */
export function movePaletteSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  const next = (current + delta) % count
  return next < 0 ? next + count : next
}

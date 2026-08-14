import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai'
import {
  activeSymbolAtom,
  activeViewAtom,
  navSectionAtom,
  settingsTabAtom,
  watchlistAtom,
} from '../../atoms'
import {
  buildPaletteCommands,
  commandPaletteOpenAtom,
  movePaletteSelection,
  type PaletteCommand,
} from '../../atoms/commandPaletteAtoms'

/**
 * Command Palette (spec §33).
 *
 * The global ⌘K / Ctrl+K hotkey is installed by `useCommandPaletteHotkey`,
 * which `CommandPalette` calls itself — so the Lead only has to mount
 * `<CommandPalette />` once at the app root. The hook is ref-counted: multiple
 * (or re-)mounts share a single `keydown` listener, and it is fully removed
 * when the last caller unmounts.
 */

let listenerRefCount = 0
let listenerInstalled = false

function onGlobalKeydown(event: KeyboardEvent): void {
  const isToggleKey = event.key.length === 1 && event.key.toLowerCase() === 'k'
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && isToggleKey) {
    event.preventDefault()
    getDefaultStore().set(commandPaletteOpenAtom, (open) => !open)
  }
}

export function useCommandPaletteHotkey(): void {
  useEffect(() => {
    if (!listenerInstalled) {
      listenerInstalled = true
      window.addEventListener('keydown', onGlobalKeydown)
    }
    listenerRefCount += 1
    return () => {
      listenerRefCount -= 1
      if (listenerRefCount <= 0) {
        listenerRefCount = 0
        listenerInstalled = false
        window.removeEventListener('keydown', onGlobalKeydown)
      }
    }
  }, [])
}

const SearchIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-foreground/38">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const CommandPalette: React.FC = () => {
  const open = useAtomValue(commandPaletteOpenAtom)
  const setOpen = useSetAtom(commandPaletteOpenAtom)
  const watchlist = useAtomValue(watchlistAtom)
  const activeSymbol = useAtomValue(activeSymbolAtom)
  const setActiveSymbol = useSetAtom(activeSymbolAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setNavSection = useSetAtom(navSectionAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useCommandPaletteHotkey()

  const commands = useMemo(
    () => buildPaletteCommands({ query, watchlist, activeSymbol }),
    [query, watchlist, activeSymbol],
  )

  // Reset query/selection and capture the previously-focused element on open,
  // then move focus into the input after the first paint.
  useEffect(() => {
    if (!open) return undefined
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setSelected(0)
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Keep the selection index within the result list as it changes.
  useEffect(() => {
    setSelected((index) => (commands.length === 0 ? 0 : Math.min(index, commands.length - 1)))
  }, [commands.length])

  if (!open) return null

  const close = (): void => {
    setOpen(false)
    restoreFocusRef.current?.focus()
  }

  const execute = (command: PaletteCommand): void => {
    if (command.kind === 'symbol' && command.symbol) {
      setActiveSymbol(command.symbol)
      setActiveView('overview')
      setNavSection('watchlist')
    } else if (command.kind === 'navigation' && command.section) {
      setNavSection(command.section)
    } else if (command.kind === 'action') {
      if (command.action === 'research-current') {
        if (activeSymbol == null && watchlist.length > 0) setActiveSymbol(watchlist[0])
        setNavSection('research')
      } else if (command.action === 'open-connections') {
        setSettingsTab('connections')
        setNavSection('settings')
      }
    }
    close()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((index) => movePaletteSelection(index, 1, commands.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((index) => movePaletteSelection(index, -1, commands.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = commands[selected]
      if (command) execute(command)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="fixed inset-0 z-(--z-index-modal) flex items-start justify-center pt-[16vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-[14px] border border-[var(--mac-border)] bg-background shadow-middle">
        <div className="flex items-center gap-2 border-b border-[var(--mac-border)] px-4">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search symbols, sections, actions…"
            className="h-12 w-full bg-transparent text-[14px] text-foreground placeholder:text-foreground/38 focus:outline-none"
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded-[6px] border border-[var(--mac-border)] px-1.5 py-0.5 text-[10px] text-foreground/38">
            Esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox" aria-label="Command results">
          {commands.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-foreground/42">No matches for “{query}”.</li>
          ) : (
            commands.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => execute(command)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] ${
                    index === selected ? 'bg-[var(--mac-sidebar-hover)] text-foreground' : 'text-foreground/78'
                  }`}
                >
                  <span className="truncate">{command.label}</span>
                  {command.hint && (
                    <span className="shrink-0 text-[11px] text-foreground/38">{command.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  type PaletteLabels,
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

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation()
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

  const labels = useMemo<PaletteLabels>(
    () => ({
      openSymbolHint: t('navigation.paletteOpenSymbolHint'),
      openSymbol: (symbol) => t('navigation.paletteOpenSymbol', { symbol }),
      goToHint: t('navigation.paletteGoToHint'),
      startResearch: (symbol) =>
        symbol != null
          ? t('navigation.paletteStartResearchOn', { symbol })
          : t('navigation.paletteStartResearchCurrent'),
      quickActionHint: t('navigation.paletteQuickActionHint'),
      openConnections: t('navigation.paletteOpenConnections'),
      quickActionSettingsHint: t('navigation.paletteQuickActionSettingsHint'),
      navigation: {
        portfolio: t('navigation.portfolio'),
        research: t('navigation.research'),
        thesis: t('navigation.thesis'),
        compare: t('navigation.compare'),
        alerts: t('navigation.alerts'),
        skills: t('navigation.skills'),
        evaluation: t('navigation.evaluation'),
        settings: t('navigation.settings'),
      },
    }),
    [t],
  )

  const commands = useMemo(
    () => buildPaletteCommands({ query, watchlist, activeSymbol, labels }),
    [query, watchlist, activeSymbol, labels],
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
      <CommandPrimitive shouldFilter={false} loop className="relative w-full max-w-xl overflow-hidden rounded-[12px] border border-border bg-surface text-foreground shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-foreground/38" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={t('navigation.paletteSearchPlaceholder')}
            className="h-12 w-full bg-transparent text-[14px] text-foreground placeholder:text-foreground/38 focus:outline-none"
            aria-label={t('navigation.paletteSearchAria')}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded-[6px] border border-[var(--mac-border)] px-1.5 py-0.5 text-[10px] text-foreground/38">
            Esc
          </kbd>
        </div>
        <CommandPrimitive.List className="max-h-[50vh] overflow-y-auto py-2" role="listbox" aria-label={t('navigation.paletteResultsAria')}>
          {commands.length === 0 ? (
            <CommandPrimitive.Empty className="px-4 py-3 text-[13px] text-foreground/42">{t('navigation.paletteNoMatches', { query })}</CommandPrimitive.Empty>
          ) : (
            commands.map((command, index) => (
              <CommandPrimitive.Item
                key={command.id}
                value={command.id}
                onSelect={() => execute(command)}
                onMouseEnter={() => setSelected(index)}
                aria-selected={index === selected}
                role="option"
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] outline-none ${index === selected ? 'bg-surface-hover text-foreground' : 'text-foreground/78'}`}
              >
                <span className="truncate">{command.label}</span>
                {command.hint && <span className="shrink-0 text-[11px] text-foreground/38">{command.hint}</span>}
              </CommandPrimitive.Item>
            ))
          )}
        </CommandPrimitive.List>
      </CommandPrimitive>
    </div>
  )
}

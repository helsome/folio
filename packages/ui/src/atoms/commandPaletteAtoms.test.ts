import { describe, expect, it } from 'bun:test'
import {
  buildPaletteCommands,
  filterCommands,
  matchWatchlistSymbols,
  movePaletteSelection,
  normalizeSymbolInput,
  NAVIGATION_COMMANDS,
  type PaletteCommand,
} from './commandPaletteAtoms'

const WATCHLIST = ['AAPL.US', 'TSLA.US', 'NVDA.US']

describe('normalizeSymbolInput', () => {
  it('normalizes a fully-qualified symbol to uppercase', () => {
    expect(normalizeSymbolInput('nvda.us')).toBe('NVDA.US')
    expect(normalizeSymbolInput('1810.HK')).toBe('1810.HK')
    expect(normalizeSymbolInput('  aapl.us ')).toBe('AAPL.US')
  })

  it('rejects bare tickers (watchlist-only search)', () => {
    expect(normalizeSymbolInput('nvda')).toBeNull()
    expect(normalizeSymbolInput('aapl')).toBeNull()
  })

  it('rejects non-symbol text and unknown markets', () => {
    expect(normalizeSymbolInput('portfolio')).toBeNull()
    expect(normalizeSymbolInput('TOOLONG.US')).toBeNull()
    expect(normalizeSymbolInput('AAPL.NASDAQ')).toBeNull()
    expect(normalizeSymbolInput('')).toBeNull()
  })
})

describe('matchWatchlistSymbols', () => {
  it('matches case-insensitively with prefix matches first', () => {
    expect(matchWatchlistSymbols('t', WATCHLIST)).toEqual(['TSLA.US'])
    expect(matchWatchlistSymbols('nv', ['AAPL.US', 'NVDA.US'])).toEqual(['NVDA.US'])
  })

  it('returns an empty list for an empty query', () => {
    expect(matchWatchlistSymbols('', WATCHLIST)).toEqual([])
    expect(matchWatchlistSymbols('   ', WATCHLIST)).toEqual([])
  })
})

describe('filterCommands', () => {
  const commands: PaletteCommand[] = [
    { id: 'nav:portfolio', kind: 'navigation', label: 'Portfolio', section: 'portfolio' },
    { id: 'nav:thesis', kind: 'navigation', label: 'Thesis', section: 'thesis' },
    { id: 'symbol:NVDA.US', kind: 'symbol', label: 'NVDA.US', symbol: 'NVDA.US' },
  ]

  it('returns everything for an empty query', () => {
    expect(filterCommands('', commands)).toEqual(commands)
  })

  it('filters by label and ranks exact/prefix/substring', () => {
    expect(filterCommands('portfolio', commands).map((c) => c.id)).toEqual(['nav:portfolio'])
    expect(filterCommands('the', commands).map((c) => c.id)).toEqual(['nav:thesis'])
  })

  it('matches a symbol command via its symbol field', () => {
    expect(filterCommands('nvd', commands).map((c) => c.id)).toEqual(['symbol:NVDA.US'])
  })
})

describe('buildPaletteCommands', () => {
  it('lists navigation + quick actions when the query is empty', () => {
    const commands = buildPaletteCommands({ query: '', watchlist: WATCHLIST, activeSymbol: null })
    expect(commands.map((c) => c.id)).toEqual([
      ...NAVIGATION_COMMANDS.map((n) => `nav:${n.section}`),
      'action:research-current',
      'action:open-connections',
    ])
  })

  it('surfaces watchlist symbol matches for a bare/partial ticker', () => {
    const commands = buildPaletteCommands({ query: 'ts', watchlist: WATCHLIST, activeSymbol: null })
    expect(commands.map((c) => c.id)).toEqual(['symbol:TSLA.US'])
    expect(commands[0]).toMatchObject({ kind: 'symbol', symbol: 'TSLA.US' })
  })

  it('offers a free-text open for a fully-qualified symbol not on the watchlist', () => {
    const commands = buildPaletteCommands({ query: 'msft.us', watchlist: WATCHLIST, activeSymbol: null })
    expect(commands.map((c) => c.id)).toEqual(['symbol:MSFT.US'])
    expect(commands[0]).toMatchObject({ kind: 'symbol', symbol: 'MSFT.US', label: 'Open MSFT.US' })
  })

  it('does not duplicate a free-text symbol that is already on the watchlist', () => {
    const commands = buildPaletteCommands({ query: 'nvda', watchlist: WATCHLIST, activeSymbol: null })
    expect(commands.map((c) => c.id)).toEqual(['symbol:NVDA.US'])
  })

  it('filters navigation by query without inventing a symbol', () => {
    const commands = buildPaletteCommands({ query: 'port', watchlist: WATCHLIST, activeSymbol: null })
    expect(commands.map((c) => c.id)).toEqual(['nav:portfolio'])
  })

  it('labels the research action with the active symbol', () => {
    const commands = buildPaletteCommands({ query: '', watchlist: WATCHLIST, activeSymbol: 'NVDA.US' })
    const research = commands.find((c) => c.action === 'research-current')
    expect(research?.label).toBe('Start research on NVDA.US')
  })
})

describe('localized labels', () => {
  const zhLabels = {
    openSymbolHint: '打开标的',
    openSymbol: (symbol: string) => `打开 ${symbol}`,
    goToHint: '前往',
    startResearch: (symbol: string | null) =>
      symbol != null ? `研究 ${symbol}` : '研究当前标的',
    quickActionHint: '快捷操作',
    openConnections: '打开连接',
    quickActionSettingsHint: '快捷操作 · 设置',
    navigation: {
      portfolio: '投资组合',
      research: '研究',
      thesis: '投资逻辑',
      compare: '对比',
      alerts: '提醒',
      skills: '技能',
      evaluation: '评测',
      settings: '设置',
    },
  }

  it('renders translated labels for command entries', () => {
    const commands = buildPaletteCommands({ query: '', watchlist: [], activeSymbol: null, labels: zhLabels })
    const nav = commands.find((c) => c.kind === 'navigation' && c.section === 'portfolio')
    expect(nav?.label).toBe('投资组合')
    const openConnections = commands.find((c) => c.action === 'open-connections')
    expect(openConnections?.label).toBe('打开连接')
  })

  it('keeps English aliases searchable under a localized label (best effort, §70)', () => {
    const commands = buildPaletteCommands({ query: '', watchlist: [], activeSymbol: null, labels: zhLabels })
    const filtered = filterCommands('ale', commands)
    const alert = filtered.find((c) => c.kind === 'navigation' && c.section === 'alerts')
    expect(alert).toBeDefined()
    expect(alert?.label).toBe('提醒')
  })
})

describe('movePaletteSelection', () => {
  it('moves forward with wrap-around', () => {
    expect(movePaletteSelection(0, 1, 3)).toBe(1)
    expect(movePaletteSelection(2, 1, 3)).toBe(0)
  })

  it('moves backward with wrap-around', () => {
    expect(movePaletteSelection(0, -1, 3)).toBe(2)
    expect(movePaletteSelection(2, -1, 3)).toBe(1)
  })

  it('returns 0 for an empty list', () => {
    expect(movePaletteSelection(5, 1, 0)).toBe(0)
  })
})

/**
 * Deterministic portfolio import parsers (spec §46–48).
 *
 * Parsing NEVER throws: every malformed line becomes a row carrying
 * user-safe `issues` (spec §103), so a single bad cell cannot sink an
 * import. Confidence tiers (spec §48):
 *   1.0 — symbol unambiguous, quantity and cost both parsed
 *   0.6 — symbol unambiguous, quantity or cost missing (review required)
 *   0.3 — symbol ambiguous (missing market suffix / unknown market)
 */
import type { ImportSource, PortfolioImportRow } from '@finagent/core'

/** Canonical symbol: 1–8 alphanumerics plus a known market suffix. */
export const SYMBOL_RE = /^[A-Z0-9]{1,8}\.(US|HK|SG|SH|SZ|HAS)$/

/** Bare ticker with no market suffix — usable, but ambiguous (review). */
export const BARE_TICKER_RE = /^[A-Z0-9]{1,8}$/

export type HeaderField = 'symbol' | 'name' | 'quantity' | 'cost' | 'currency' | 'account'

/**
 * Header aliases for CSV column detection (English + 中文). Header cells are
 * matched after lowercasing and stripping spaces/underscores/hyphens.
 */
export const HEADER_ALIASES: Record<HeaderField, readonly string[]> = {
  symbol: ['symbol', 'ticker', 'code', 'stock', '代码', '股票代码', '证券代码'],
  name: ['name', 'company', 'stockname', '名称', '股票名称', '证券名称'],
  quantity: ['quantity', 'qty', 'shares', '数量', '持股数量', '股数', '持仓数量'],
  cost: [
    'cost',
    'costprice',
    'cost price',
    'price',
    'avgcost',
    'avg cost',
    '成本',
    '成本价',
    '买入价',
    '持仓成本',
    '均价',
  ],
  currency: ['currency', 'ccy', '货币', '币种'],
  account: ['account', '账户', '账号', '组合'],
}

/** Explicit column-name override, e.g. `{ symbol: 'Ticker', cost: 'Avg Cost' }`. */
export type CsvHeaderMapping = Partial<Record<HeaderField, string>>

export interface SymbolCheck {
  /** Normalized (uppercase, stripped) symbol — may be '' when absent. */
  symbol: string
  /** True when the symbol cannot be deterministically resolved. */
  ambiguous: boolean
  /** User-safe issue when ambiguous; undefined otherwise. */
  issue?: string
}

/** Normalize a raw symbol cell: uppercase, strip non-alphanumeric/dot junk. */
export function normalizeImportSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')
}

/** Classify a symbol cell into canonical / bare / malformed. Never throws. */
export function checkSymbol(raw: string): SymbolCheck {
  const symbol = normalizeImportSymbol(raw)
  if (symbol === '') {
    return { symbol, ambiguous: true, issue: 'Missing symbol' }
  }
  if (SYMBOL_RE.test(symbol)) {
    return { symbol, ambiguous: false }
  }
  if (BARE_TICKER_RE.test(symbol)) {
    return {
      symbol,
      ambiguous: true,
      issue: `Symbol "${symbol}" is missing a market suffix (e.g. ${symbol}.US)`,
    }
  }
  return {
    symbol,
    ambiguous: true,
    issue: `Symbol "${symbol}" is not a recognized ticker format (e.g. AAPL.US)`,
  }
}

/**
 * Coerce a CSV/paste cell to a finite number. Strings with thousands
 * separators or a leading `$` are handled; empty/null/non-numeric → undefined.
 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return undefined
  }
  const cleaned = trimmed.replace(/[,$\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

// ── CSV ────────────────────────────────────────────────────────────────────

/** Split CSV text into logical rows, honoring quoted fields spanning lines. */
export function splitCsvRows(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const rows: string[] = []
  let current = ''
  let inQuotes = false
  for (const line of lines) {
    current = current === '' ? line : `${current}\n${line}`
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes
    }
    if (!inQuotes && current !== '') {
      rows.push(current)
      current = ''
    }
  }
  if (current !== '') rows.push(current)
  return rows
}

/** Split one CSV row into cells (comma or tab separated, quote-aware). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',' || ch === '\t') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s_\-]/g, '')
}

/** Field → resolved column index for one CSV file. */
export interface CsvColumnMap {
  isHeader: boolean
  /** Column index → field. */
  byIndex: Map<number, HeaderField>
}

/**
 * Resolve CSV columns from the first row. When an explicit `headerMapping` is
 * supplied, those fields look up the given names first; every field also
 * falls back to alias auto-detection. A file with no recognized header falls
 * back to positional columns [symbol, name, quantity, cost, currency, account].
 */
export function resolveCsvColumns(
  firstRow: string,
  headerMapping?: CsvHeaderMapping
): CsvColumnMap {
  const cells = splitCsvLine(firstRow).map(normalizeHeaderCell)
  const byIndex = new Map<number, HeaderField>()
  const fields = Object.keys(HEADER_ALIASES) as HeaderField[]

  for (const field of fields) {
    const explicit = headerMapping?.[field]
    let found = -1
    if (explicit !== undefined) {
      found = cells.indexOf(normalizeHeaderCell(explicit))
    }
    if (found === -1) {
      found = cells.findIndex((cell) => HEADER_ALIASES[field].some((alias) => normalizeHeaderCell(alias) === cell))
    }
    if (found >= 0) byIndex.set(found, field)
  }

  if (byIndex.size === 0) {
    // No header row: positional fallback in canonical field order.
    const fallback: HeaderField[] = ['symbol', 'name', 'quantity', 'cost', 'currency', 'account']
    fallback.forEach((field, index) => byIndex.set(index, field))
    return { isHeader: false, byIndex }
  }
  return { isHeader: true, byIndex }
}

export interface ParsedFields {
  symbol: string
  name: string | undefined
  quantity: string | undefined
  cost: string | undefined
  currency: string | undefined
  account: string | undefined
}

function fieldsFromCells(cells: string[], byIndex: Map<number, HeaderField>): ParsedFields {
  const fields: ParsedFields = {
    symbol: '',
    name: undefined,
    quantity: undefined,
    cost: undefined,
    currency: undefined,
    account: undefined,
  }
  for (const [index, field] of byIndex) {
    const cell = cells[index]
    if (cell === undefined) continue
    const trimmed = cell.trim()
    switch (field) {
      case 'symbol':
        fields.symbol = trimmed
        break
      case 'name':
        fields.name = trimmed === '' ? undefined : trimmed
        break
      case 'quantity':
        fields.quantity = trimmed === '' ? undefined : trimmed
        break
      case 'cost':
        fields.cost = trimmed === '' ? undefined : trimmed
        break
      case 'currency':
        fields.currency = trimmed === '' ? undefined : trimmed
        break
      case 'account':
        fields.account = trimmed === '' ? undefined : trimmed
        break
    }
  }
  return fields
}

/** Build a row from parsed fields; malformed cells become issues, never throws. */
export function buildRow(fields: ParsedFields): PortfolioImportRow {
  const symbolCheck = checkSymbol(fields.symbol)
  const issues: string[] = []
  if (symbolCheck.issue !== undefined) {
    issues.push(symbolCheck.issue)
  }

  const quantity = toFiniteNumber(fields.quantity)
  if (fields.quantity !== undefined && quantity === undefined) {
    issues.push(`Invalid quantity "${fields.quantity}"`)
  } else if (quantity === undefined && !symbolCheck.ambiguous) {
    issues.push('Quantity missing')
  }

  const costPrice = toFiniteNumber(fields.cost)
  if (fields.cost !== undefined && costPrice === undefined) {
    issues.push(`Invalid cost price "${fields.cost}"`)
  } else if (costPrice === undefined && !symbolCheck.ambiguous) {
    issues.push('Cost price missing')
  }

  const confidence = symbolCheck.ambiguous
    ? 0.3
    : quantity === undefined || costPrice === undefined
      ? 0.6
      : 1.0

  return {
    symbol: symbolCheck.symbol,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(costPrice !== undefined ? { costPrice } : {}),
    ...(fields.currency !== undefined ? { currency: fields.currency.trim().toUpperCase() } : {}),
    ...(fields.account !== undefined ? { account: fields.account } : {}),
    confidence,
    issues,
  }
}

/** Flag duplicate canonical symbols across a parsed batch (spec §103). */
export function flagDuplicates(rows: PortfolioImportRow[]): PortfolioImportRow[] {
  const seen = new Map<string, number>()
  for (const row of rows) {
    if (row.symbol === '') continue
    const count = (seen.get(row.symbol) ?? 0) + 1
    seen.set(row.symbol, count)
    if (count > 1) {
      row.issues.push(`Duplicate symbol "${row.symbol}"`)
    }
  }
  return rows
}

/**
 * Parse CSV text into import rows. Auto-detects the header (EN + 中文 aliases,
 * or an explicit `headerMapping`), coerces numerics, isolates malformed rows
 * into `issues[]`, and flags duplicates. Never throws.
 */
export function parseCsv(text: string, headerMapping?: CsvHeaderMapping): PortfolioImportRow[] {
  const rawRows = splitCsvRows(text)
  if (rawRows.length === 0) return []
  const columns = resolveCsvColumns(rawRows[0], headerMapping)
  const start = columns.isHeader ? 1 : 0

  const rows: PortfolioImportRow[] = []
  for (let i = start; i < rawRows.length; i++) {
    const cells = splitCsvLine(rawRows[i])
    if (cells.every((cell) => cell.trim() === '')) continue
    rows.push(buildRow(fieldsFromCells(cells, columns.byIndex)))
  }
  return flagDuplicates(rows)
}

// ── Paste ──────────────────────────────────────────────────────────────────

/** Split pasted text into non-empty lines (CRLF/LF safe). */
export function splitPasteLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Parse one pasted line into fields. Supported formats (spec §46):
 *   SYMBOL QTY COST | SYMBOL, QTY, COST | symbol cost
 * An optional fourth token is read as currency. Extra tokens are ignored.
 */
export function parsePasteLine(line: string): PortfolioImportRow {
  const trimmed = line.trim()
  const parts = trimmed.includes(',')
    ? trimmed
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
    : trimmed.split(/\s+/)

  const fields: ParsedFields = { symbol: '', name: undefined, quantity: undefined, cost: undefined, currency: undefined, account: undefined }
  if (parts.length >= 1) fields.symbol = parts[0]
  if (parts.length >= 3) {
    fields.quantity = parts[1]
    fields.cost = parts[2]
  } else if (parts.length === 2) {
    // Two-token form is "symbol cost" per spec §46.
    fields.cost = parts[1]
  }
  if (parts.length >= 4) fields.currency = parts[3]
  return buildRow(fields)
}

/** Parse pasted lines into import rows (spec §46); never throws. */
export function parsePaste(text: string): PortfolioImportRow[] {
  return flagDuplicates(splitPasteLines(text).map(parsePasteLine))
}

/** Route a parse by import source. */
export function parseImportText(source: ImportSource, text: string): PortfolioImportRow[] {
  if (source === 'csv') return parseCsv(text)
  if (source === 'paste') return parsePaste(text)
  // 'screenshot' has no parser yet (vision is out of V5 scope).
  return []
}

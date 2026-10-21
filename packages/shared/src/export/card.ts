import type { ResearchReport, ResearchSection, ResearchStance, ResearchVerdict } from '@finagent/core'
import { strategyName } from './markdown.ts'

/**
 * Share-card renderer for a ResearchReport (spec §54).
 *
 * Produces a self-contained SVG snapshot plus the equivalent plain text for
 * clipboard copy. Pure and deterministic: identical input → identical bytes.
 *
 * PRIVACY (spec §55): the card renders ONLY report content — symbol, stance,
 * confidence, section verdicts, the top risk and the date. Portfolio size,
 * positions, account balances or any other user-account data never appear
 * because the report domain carries none; `redactForShare` (privacy.ts) is
 * the defensive backstop for reports that somehow carry account-like fields.
 */

export interface ShareCard {
  svg: string
  /** Plain-text mirror of the card content for copy-to-clipboard. */
  text: string
}

const CARD_WIDTH = 640
const CARD_HEIGHT = 460

const FONT_FAMILY = "'SF Mono', 'JetBrains Mono', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', ui-monospace, monospace"

const STANCE_LABEL: Record<ResearchStance, string> = {
  bullish: 'BULLISH',
  bearish: 'BEARISH',
  neutral: 'NEUTRAL',
}

const STANCE_TONE: Record<ResearchStance, string> = {
  bullish: '#34d399',
  bearish: '#f87171',
  neutral: '#a3aab8',
}

const VERDICT_LABEL: Record<ResearchVerdict, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
  unavailable: 'Unavailable',
}

const VERDICT_TONE: Record<ResearchVerdict, string> = {
  positive: '#34d399',
  negative: '#f87171',
  neutral: '#a3aab8',
  unavailable: '#fbbf24',
}

/** Keys whose section verdicts the card prefers, in display order. */
const PREFERRED_SECTION_KEYS = ['growth', 'valuation', 'risk'] as const

/** Escape a string for safe embedding in XML/SVG content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Up to three sections for the card: growth/valuation/risk-like keys first
 * (in that preference order), then remaining sections in report order.
 * Deterministic and total — always returns the same pick for the same report.
 */
export function pickShareSections(report: ResearchReport): ResearchSection[] {
  const chosen: ResearchSection[] = []
  const seen = new Set<ResearchSection>()
  for (const key of PREFERRED_SECTION_KEYS) {
    const section = report.sections.find((s) => s.key.toLowerCase().includes(key) && !seen.has(s))
    if (section) {
      chosen.push(section)
      seen.add(section)
    }
  }
  const rest = report.sections.filter((s) => !seen.has(s))
  return [...chosen, ...rest].slice(0, 3)
}

/**
 * Code points rendered twice as wide as a Latin glyph by the card's font stack:
 * CJK ideographs and punctuation, kana, hangul and fullwidth forms.
 */
const FULL_WIDTH_RE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

function isFullWidth(char: string): boolean {
  return FULL_WIDTH_RE.test(char)
}

/** Width of `value` in card columns; a full-width glyph occupies two columns. */
function displayWidth(value: string): number {
  let width = 0
  for (const char of value) width += isFullWidth(char) ? 2 : 1
  return width
}

/** The smallest run the card never splits, plus the whitespace that precedes it. */
interface WrapAtom {
  text: string
  lead: string
}

/**
 * Split text into wrap atoms. Break opportunities exist after whitespace and
 * between CJK glyphs, which is where everyday CJK line breaking allows a break;
 * a run of Latin characters stays one atom, so it never breaks mid-word.
 */
function atomize(text: string): WrapAtom[] {
  const atoms: WrapAtom[] = []
  let lead = ''
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    atoms.push({ text: buffer, lead })
    buffer = ''
    lead = ''
  }
  for (const char of text) {
    if (/\s/.test(char)) {
      flush()
      lead += char
    } else if (isFullWidth(char)) {
      flush()
      atoms.push({ text: char, lead })
      lead = ''
    } else {
      buffer += char
    }
  }
  flush()
  return atoms
}

/**
 * Split text into lines of at most `maxColumns` display columns.
 *
 * A full-width glyph counts as two columns and CJK text breaks between
 * ideographs, so a whitespace-free Chinese sentence no longer reaches the card
 * as one over-wide line. Whitespace between atoms is preserved verbatim. A
 * Latin run never breaks, so a single over-long word still gets its own line.
 */
export function wrapText(text: string, maxColumns: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const atom of atomize(text)) {
    const joined = current ? current + atom.lead + atom.text : atom.text
    if (current && displayWidth(joined) > maxColumns) {
      lines.push(current)
      current = atom.text
    } else {
      current = joined
    }
  }
  if (current) lines.push(current)
  return lines
}

/** `text` clipped so its display width does not exceed `maxColumns`. */
function clampToColumns(text: string, maxColumns: number): string {
  let width = 0
  let end = 0
  for (const char of text) {
    const next = width + (isFullWidth(char) ? 2 : 1)
    if (next > maxColumns) break
    width = next
    end += char.length
  }
  return text.slice(0, end)
}

/** Column budget of the risk block: two card lines of `RISK_LINE_COLUMNS`. */
const RISK_LINE_COLUMNS = 56
const RISK_MAX_COLUMNS = RISK_LINE_COLUMNS * 2
const ELLIPSIS = '…'

/** The first risk bullet, trimmed to at most two card lines. */
function keyRiskLines(report: ResearchReport): string[] {
  const risk = report.risks[0]
  if (!risk) return []
  let body = risk
  if (displayWidth(body) > RISK_MAX_COLUMNS) {
    // Reserve the ellipsis so the trimmed text still fits the two-line budget.
    const clipped = clampToColumns(body, RISK_MAX_COLUMNS - displayWidth(ELLIPSIS))
    body = clipped.replace(/\s+\S*$/, '') + ELLIPSIS
  }
  return wrapText(body, RISK_LINE_COLUMNS)
}

export function reportToShareCard(report: ResearchReport): ShareCard {
  const sections = pickShareSections(report)
  const strategy = strategyName(report.strategyId)
  const generated = new Date(report.generatedAt).toISOString()
  const confidence = Math.round(report.confidence * 100)
  const riskLines = keyRiskLines(report)

  const verdictRows = sections
    .map((section, index) => {
      const y = 164 + index * 34
      return [
        `<text x="32" y="${y}" font-size="15" fill="#c9d1dc" font-family="${FONT_FAMILY}">${escapeXml(section.title)}</text>`,
        `<text x="608" y="${y}" text-anchor="end" font-size="15" font-weight="600" fill="${VERDICT_TONE[section.verdict]}" font-family="${FONT_FAMILY}">${VERDICT_LABEL[section.verdict]}</text>`,
      ].join('\n')
    })
    .join('\n')

  const strategyLine = strategy
    ? `<text x="32" y="92" font-size="13" fill="#8b93a1" font-family="${FONT_FAMILY}">${escapeXml(strategy)}</text>`
    : ''
  const dateLine = `<text x="608" y="96" text-anchor="end" font-size="12" fill="#6b7480" font-family="${FONT_FAMILY}">${escapeXml(generated)}</text>`

  const riskBlock =
    riskLines.length === 0
      ? `<text x="32" y="310" font-size="13" fill="#8b93a1" font-family="${FONT_FAMILY}">No key risks flagged.</text>`
      : riskLines
          .map(
            (line, index) =>
              `<text x="32" y="${310 + index * 24}" font-size="13" fill="#c9d1dc" font-family="${FONT_FAMILY}">${escapeXml(line)}</text>`
          )
          .join('\n')

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="Folio research snapshot for ${escapeXml(report.symbol)}">`,
    `  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="#10141a"/>`,
    `  <rect width="${CARD_WIDTH}" height="6" fill="${STANCE_TONE[report.stance]}"/>`,
    `  <text x="32" y="54" font-size="34" font-weight="700" fill="#f5f7fa" font-family="${FONT_FAMILY}">${escapeXml(report.symbol)}</text>`,
    `  <text x="608" y="54" text-anchor="end" font-size="18" font-weight="700" fill="${STANCE_TONE[report.stance]}" font-family="${FONT_FAMILY}">${STANCE_LABEL[report.stance]}</text>`,
    `  <text x="608" y="78" text-anchor="end" font-size="13" fill="#8b93a1" font-family="${FONT_FAMILY}">${confidence}% confidence</text>`,
    strategyLine,
    dateLine,
    `  <line x1="32" y1="124" x2="608" y2="124" stroke="#232a33" stroke-width="1"/>`,
    verdictRows,
    `  <text x="32" y="280" font-size="11" letter-spacing="1.5" fill="#6b7480" font-family="${FONT_FAMILY}">KEY RISK</text>`,
    riskBlock,
    `  <line x1="32" y1="384" x2="608" y2="384" stroke="#232a33" stroke-width="1"/>`,
    `  <text x="32" y="418" font-size="13" font-weight="700" fill="#f5f7fa" font-family="${FONT_FAMILY}">Folio</text>`,
    `  <text x="608" y="418" text-anchor="end" font-size="11" fill="#6b7480" font-family="${FONT_FAMILY}">Research snapshot</text>`,
    '</svg>',
  ].join('\n')

  const textLines: string[] = [
    `${report.symbol} — ${STANCE_LABEL[report.stance]} · ${confidence}% confidence`,
  ]
  const meta: string[] = [`Generated ${generated}`]
  if (strategy) meta.unshift(strategy)
  textLines.push(meta.join(' · '))
  for (const section of sections) {
    textLines.push(`${section.title}: ${VERDICT_LABEL[section.verdict]}`)
  }
  textLines.push(report.risks[0] ? `Key risk: ${report.risks[0]}` : 'Key risk: none flagged')
  textLines.push('— Folio research snapshot')

  return { svg, text: textLines.join('\n') }
}

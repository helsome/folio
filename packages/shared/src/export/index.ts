/**
 * Export & share surface (spec §54–55).
 *
 * Pure, deterministic renderers for ResearchReport → Markdown and a share
 * card (SVG + plain text), plus a defensive privacy redaction. The main
 * process wires these behind `export:markdown` / `export:shareCard` IPC
 * channels; the renderer only ever sees finished strings.
 */

export { reportToMarkdown, strategyName, STANCE_LABEL, VERDICT_LABEL, type MarkdownOptions } from './markdown.ts'
export { escapeXml, pickShareSections, reportToShareCard, wrapText, type ShareCard } from './card.ts'
export { ACCOUNT_LIKE_KEY, redactForShare } from './privacy.ts'

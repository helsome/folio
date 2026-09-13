import type { EvidenceRef, ResearchReport } from '@finagent/core';
import { reportToMarkdown } from './markdown.ts';

export interface ExportCitation {
  number: number;
  claim: string;
  capabilityId: string;
  runId: string;
  fetchedAt: number;
  source?: { id?: string; url?: string; provider?: string };
  financial?: {
    instrumentId?: string;
    metric?: string;
    asOf?: number;
    currency?: string;
    unit?: string;
  };
  status?: EvidenceRef['status'];
}

export interface ExportSource {
  id?: string;
  url?: string;
  provider?: string;
}

export interface ResearchArchive {
  schemaVersion: 'folio-report-export-v1';
  exportedAt: number;
  report: ResearchReport;
  claims: Array<{ sectionKey: string; sectionTitle: string; claim: string; citationNumbers: number[] }>;
  citations: ExportCitation[];
  sources: ExportSource[];
  runManifest?: ResearchReport['runManifest'];
}

function evidenceKey(ref: EvidenceRef): string {
  return [ref.runId, ref.sourceId ?? '', ref.metric ?? '', ref.claim].join('\u001f');
}

export function citationIndex(report: ResearchReport): Map<string, number> {
  const index = new Map<string, number>();
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      const key = evidenceKey(ref);
      if (!index.has(key)) index.set(key, index.size + 1);
    }
  }
  return index;
}

export function reportToArchive(report: ResearchReport, exportedAt: number = report.generatedAt): ResearchArchive {
  const index = citationIndex(report);
  const citations: ExportCitation[] = [];
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      const number = index.get(evidenceKey(ref))!;
      if (citations.some((citation) => citation.number === number)) continue;
      citations.push({
        number,
        claim: ref.claim,
        capabilityId: ref.capabilityId,
        runId: ref.runId,
        fetchedAt: ref.fetchedAt,
        ...(ref.sourceId || ref.sourceUrl || ref.provider
          ? { source: { id: ref.sourceId, url: ref.sourceUrl, provider: ref.provider } }
          : {}),
        financial: {
          instrumentId: ref.instrumentId,
          metric: ref.metric,
          asOf: ref.asOf,
          currency: ref.currency,
          unit: ref.unit,
        },
        status: ref.status,
      });
    }
  }
  const sources = [...new Map(
    citations
      .map((citation) => citation.source)
      .filter((source): source is ExportSource => Boolean(source))
      .map((source) => [`${source.id ?? ''}\u001f${source.url ?? ''}\u001f${source.provider ?? ''}`, source])
  ).values()];
  return {
    schemaVersion: 'folio-report-export-v1',
    exportedAt,
    report,
    claims: report.sections.map((section) => ({
      sectionKey: section.key,
      sectionTitle: section.title,
      claim: section.summary,
      citationNumbers: section.evidence.map((ref) => index.get(evidenceKey(ref))!),
    })),
    citations,
    sources,
    runManifest: report.runManifest,
  };
}

export function reportToJson(report: ResearchReport): string {
  return `${JSON.stringify(reportToArchive(report), null, 2)}\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

/** Render the report's small Markdown subset without scripts or external assets. */
function markdownBlocks(value: string): string {
  const lines = value.split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const separator = lines[index + 1];
    if (line.includes('|') && separator && tableCells(separator).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) rows.push(tableCells(lines[index++]!));
      output.push(`<table><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length + 2;
      output.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`);
    } else if (line.trim()) {
      output.push(`<p>${escapeHtml(line.trim())}</p>`);
    }
    index += 1;
  }
  return output.join('');
}

/** Self-contained, print-ready HTML. Browsers can save it as PDF without losing citations. */
export function reportToHtml(report: ResearchReport): string {
  const archive = reportToArchive(report);
  const sections = report.sections.map((section, sectionIndex) => {
    const refs = archive.claims[sectionIndex]?.citationNumbers ?? [];
    const marks = refs.map((number) => `<a class="citation" href="#citation-${number}">[${number}]</a>`).join(' ');
    return `<section><h2>${escapeHtml(section.title)}</h2><p class="verdict">${escapeHtml(section.verdict)}</p>${markdownBlocks(section.summary)}${marks}</section>`;
  }).join('');
  const citations = archive.citations.map((citation) => {
    const sourceUrl = safeHttpUrl(citation.source?.url);
    const source = sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(citation.source?.provider ?? sourceUrl)}</a>`
      : escapeHtml([citation.financial?.instrumentId, citation.financial?.metric, citation.financial?.currency, citation.financial?.unit].filter(Boolean).join(' · ') || citation.capabilityId);
    return `<li id="citation-${citation.number}"><strong>[${citation.number}]</strong> ${escapeHtml(citation.claim)}<br><span>${source} · run ${escapeHtml(citation.runId)} · ${new Date(citation.fetchedAt).toISOString()}</span></li>`;
  }).join('');
  return `<!doctype html><html lang="${escapeHtml(report.locale ?? 'en-US')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.symbol)} Research Report</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:820px;margin:48px auto;padding:0 28px;color:#18202a}h1{font-size:2.25rem}h2{margin-top:2rem;border-bottom:1px solid #d7dde5;padding-bottom:.35rem}.meta,.verdict,footer{color:#586474}.citation{font-size:.8em;text-decoration:none}li{margin:.8rem 0}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #ccd3dc;padding:.45rem;text-align:left}th{background:#f5f7fa}@media print{body{margin:0;max-width:none}.citation{color:inherit}a{color:inherit;text-decoration:none}section{break-inside:avoid}}</style></head><body><header><h1>${escapeHtml(report.symbol)} Research Report</h1><p class="meta">Generated ${new Date(report.generatedAt).toISOString()} · ${escapeHtml(report.stance)} · ${Math.round(report.confidence * 100)}%</p>${markdownBlocks(report.summary)}</header><main>${sections}<section><h2>Evidence</h2><ol>${citations}</ol></section></main><footer>Folio export · schema folio-report-export-v1 · run ${escapeHtml(report.runManifest?.runId ?? report.id)}</footer></body></html>`;
}

export function reportExportBundle(report: ResearchReport): { markdown: string; html: string; json: string } {
  return { markdown: reportToMarkdown(report), html: reportToHtml(report), json: reportToJson(report) };
}

/** Real provider + generated Agent tool path. No LLM, mocks, or paid sources. */
import { strict as assert } from 'node:assert';
import { createFullRegistry, createCapabilityTools } from '../packages/shared/src/capabilities/index.ts';
import type { DocumentEvidence, ResearchDocumentResult } from '@finagent/core';

if (!process.env.FINAGENT_SEC_USER_AGENT) throw new Error('Set FINAGENT_SEC_USER_AGENT with your contact; never commit its value.');
const tools = createCapabilityTools(createFullRegistry().list());
const signal = AbortSignal.timeout(120_000);
async function call<T>(name: string, input: unknown): Promise<T> {
  const tool = tools.find((item) => item.name === name);
  assert(tool, `Missing production tool ${name}`);
  const result = await tool.execute('live-issue-32', input, signal);
  const text = result.content[0].text;
  return JSON.parse(text.slice(text.lastIndexOf('\n\nDATA: ') + 8)) as T;
}
const filings = await call<ResearchDocumentResult>('search_research_documents', { symbol: 'AAPL.US', subtype: '10-K', authority: 'SEC', limit: 2 });
const announcements = await call<ResearchDocumentResult>('search_research_documents', { symbol: 'AAPL.US', authority: 'Apple', limit: 2 });
assert(filings.sources.some((s) => s.providerId === 'sec-edgar' && s.status === 'ok'));
assert(announcements.sources.some((s) => s.providerId === 'apple-newsroom' && s.status === 'ok'));
const filing = filings.documents[0];
const announcement = announcements.documents[0];
assert(filing && announcement, 'Both real providers must return documents');
assert.equal(filing.issuerId, announcement.issuerId);
assert.equal(filing.sourceType, 'regulatory_filing');
const financialEvidence = await call<DocumentEvidence[]>('get_document_evidence', { url: filing.canonicalUrl, query: 'Net sales' });
const announcementEvidence = await call<DocumentEvidence[]>('get_document_evidence', { url: announcement.canonicalUrl, query: 'Apple' });
assert(financialEvidence.length > 0, 'Long annual filing must yield a real financial evidence span');
assert(announcementEvidence.length > 0, 'Official announcement must yield a real evidence span');
for (const e of [...financialEvidence, ...announcementEvidence]) {
  assert(e.url.includes('#:~:text='));
  assert.equal(e.span.end - e.span.start, e.quote.length);
  assert.match(e.contentHash, /^[a-f0-9]{64}$/);
}
assert.equal(financialEvidence[0].documentId, filing.documentId);
assert.equal(announcementEvidence[0].documentId, announcement.documentId);
console.log(`# Apple source research — ${new Date().toISOString()}\n`);
console.log('Real production registry → generated Agent tools → SEC/Apple → HTML evidence. This deterministic source report does not exercise an LLM or Electron UI.\n');
for (const [doc, evidence] of [[filing, financialEvidence], [announcement, announcementEvidence]] as const) {
  console.log(`## ${doc.sourceType}: ${doc.title}\n`);
  console.log(`Publisher: ${doc.publisher}; published: ${doc.publishedAt}; reporting period: ${doc.reportingPeriod?.end ?? 'not supplied'}.\n`);
  console.log(`Document: [official source](${doc.canonicalUrl})\n`);
  // Include one bounded excerpt; the full copyrighted source is never saved.
  const e = evidence[0];
  console.log(`> ${e.quote}\n\n[Jump to source evidence](${e.url})\n`);
  console.log(`Evidence ID: ${e.evidenceId}; normalized text span: ${e.span.start}–${e.span.end}; SHA-256: ${e.contentHash}.\n`);
}
console.log('PASS: two real primary-source connectors; common issuer; long 10-K evidence; source types and evidence jumps in final report.');

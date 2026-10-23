import { describe, expect, it } from 'bun:test';
import { ResearchDocumentService, normalizeQuery, decodeText, documentSummary } from './service.ts';
import { assertDocumentUrl } from './http.ts';
import { createResearchDocumentCapabilities } from '../capabilities/manifests/research-documents.ts';
import { createCapabilityTools } from '../capabilities/pi-tools.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { ResearchRunner } from '../research/runner.ts';
import { LocalResearchSynthesizer } from '../research/synthesizer-local.ts';

const filing = 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm';
const columns = (amendment = false) => ({
  accessionNumber: [amendment ? '0000320193-25-000080' : '0000320193-25-000079'],
  primaryDocument: ['aapl-20250927.htm'], form: [amendment ? '10-K/A' : '10-K'],
  filingDate: [amendment ? '2025-11-10' : '2025-10-31'], reportDate: ['2025-09-27'],
  primaryDocDescription: ['Annual report'],
});
const feed = `<feed><entry><id>apple-announcement</id><title>Apple reports fourth quarter results</title><published>2025-10-30T20:30:00Z</published><link href="https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/"/></entry></feed>`;
function fixture(options: { failure?: boolean; history?: boolean } = {}) {
  const urls: string[] = [];
  const service = new ResearchDocumentService(async (url) => {
    urls.push(url);
    if (url.includes('rss-feed')) return feed;
    if (options.failure) throw new Error('HTTP 403');
    if (url.includes('-submissions-')) return JSON.stringify(columns());
    if (url.endsWith('.json')) return JSON.stringify({ filings: {
      recent: columns(!!options.history),
      files: options.history ? [{ name: 'CIK0000320193-submissions-001.json', filingFrom: '2025-01-01', filingTo: '2025-10-31' }] : [],
    } });
    return '<html><head><title>invented revenue</title></head><body><nav>invented navigation</nav><main><script>invented revenue</script><h1>Financial statements</h1><p>Net sales were 100 for this synthetic test. Revenue increased.</p></main></body></html>';
  }, () => 1234);
  return { service, urls };
}

describe('research documents', () => {
  it('carries document identity and real evidence spans into the research report', async () => {
    const runner = new ResearchRunner({
      registry: createCapabilityRegistry(createResearchDocumentCapabilities(fixture().service)),
      synthesizer: new LocalResearchSynthesizer(),
    });
    const result = await runner.run({ symbol: 'AAPL.US', runId: 'document-integration' });
    const section = result.report?.sections.find((s) => s.key === 'research.documents');
    const ref = section?.evidence.find((e) => e.sourceType === 'regulatory_filing');
    expect(ref?.documentId).toBe('sec:0000320193:0000320193-25-000079');
    expect(ref?.canonicalUrl).toBe(filing);
    expect(ref?.documentEvidence?.[0].quote).toContain('Revenue');
    expect(result.report?.capabilityRuns.some((r) => r.runId === ref?.runId && r.status === 'success')).toBe(true);
  });
  it('normalizes symbols without silently accepting a conflicting issuer', () => {
    expect(normalizeQuery({ symbol: ' aapl.us ' }).symbol).toBe('AAPL.US');
    expect(() => normalizeQuery({ symbol: 'AAPL.US', cik: '1234' })).toThrow('conflicts');
  });
  it.each(['AAPL', '../AAPL.US', 'AAPL.US;echo'])('rejects invalid symbol %s', (symbol) => {
    expect(() => normalizeQuery({ symbol })).toThrow();
  });
  it.each(['2025-02-30', 'not a date', '2025-1-1'])('rejects invalid date %s', (date) => {
    expect(() => normalizeQuery({ symbol: 'AAPL.US', periodEnd: date })).toThrow();
  });
  it('rejects inverted dates and invalid limits', () => {
    expect(() => normalizeQuery({ symbol: 'AAPL.US', publishedFrom: '2025-12-01', publishedTo: '2025-01-01' })).toThrow();
    expect(() => normalizeQuery({ symbol: 'AAPL.US', limit: 51 })).toThrow();
  });
  it('retrieves two primary source types with common issuer and honest metadata', async () => {
    const { service } = fixture();
    const result = await service.search({ symbol: 'AAPL.US' });
    expect(result.sources.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(result.documents.map((d) => d.sourceType)).toEqual(['regulatory_filing', 'earnings_release']);
    expect(new Set(result.documents.map((d) => d.issuerId)).size).toBe(1);
    expect(result.documents[0].canonicalUrl).toBe(filing);
    expect(result.documents[1].reportingPeriod).toBeUndefined();
    expect(result.documents.every((d) => d.licensing.telemetryAllowed === false)).toBe(true);
  });
  it('filters historical period and includes linked amendments', async () => {
    const { service, urls } = fixture({ history: true });
    const result = await service.search({ symbol: 'AAPL.US', subtype: '10-K', periodEnd: '2025-09-27' });
    expect(urls.some((u) => u.endsWith('-submissions-001.json'))).toBe(true);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].version.amendsDocumentId).toBe(result.documents[1].documentId);
    expect(result.documents[0].version.familyId).toBe(result.documents[1].version.familyId);
  });
  it('does not treat an unknown IR period as a requested period', async () => {
    const result = await fixture().service.search({ symbol: 'AAPL.US', periodEnd: '2024-09-28' });
    expect(result.documents).toHaveLength(0);
  });
  it('applies date and authority filters', async () => {
    const result = await fixture().service.search({ symbol: 'AAPL.US', authority: 'Apple', publishedTo: '2025-10-30' });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].providerId).toBe('apple-newsroom');
  });
  it('surfaces provider failures while preserving independent results', async () => {
    const result = await fixture({ failure: true }).service.search({ symbol: 'AAPL.US' });
    expect(result.sources[0].status).toBe('failed');
    expect(result.documents).toHaveLength(1);
    expect(documentSummary(result)).toContain('HTTP 403');
  });
  it('reports unsupported issuers instead of returning invented data', async () => {
    const { service, urls } = fixture();
    const result = await service.search({ symbol: '0700.HK' });
    expect(result.sources.every((s) => s.status === 'unavailable')).toBe(true);
    expect(urls).toHaveLength(0);
  });
  it('propagates cancellation instead of returning partial success', async () => {
    const signal = AbortSignal.abort();
    await expect(fixture().service.search({ symbol: 'AAPL.US' }, signal)).rejects.toThrow();
  });
  it('returns stable bounded evidence with exact extracted offsets and jump URL', async () => {
    const { service } = fixture();
    const evidence = await service.evidence(filing, 'Net sales');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].documentId).toBe('sec:0000320193:0000320193-25-000079');
    expect(evidence[0].quote).not.toContain('invented');
    expect(evidence[0].span.end - evidence[0].span.start).toBe(evidence[0].quote.length);
    expect(evidence[0].url).toContain('#:~:text=');
    expect(await service.evidence(filing, 'Net sales')).toEqual(evidence);
    expect(await service.evidence(filing, 'absent fact')).toEqual([]);
  });
  it.each(['http://www.sec.gov/a', 'https://www.sec.gov.evil.test/a', 'https://127.0.0.1/a', 'https://user@www.sec.gov/a', 'https://www.sec.gov:444/a'])('rejects unsafe URL %s', (url) => {
    expect(() => assertDocumentUrl(url)).toThrow();
  });
  it('rejects non-document paths and PDFs before fetching', async () => {
    const { service, urls } = fixture();
    await expect(service.evidence('https://www.sec.gov/', 'revenue')).rejects.toThrow();
    await expect(service.evidence(filing.replace('.htm', '.pdf'), 'revenue')).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });
  it('decodes numeric entities without throwing on invalid Unicode', () => {
    expect(decodeText('A&nbsp;B &#x41; &#99999999;')).toBe('A B A');
  });
  it('exposes working Agent tools, with validated input and source/evidence links', async () => {
    const tools = createCapabilityTools(createResearchDocumentCapabilities(fixture().service));
    const search = await tools[0].execute('s', { symbol: 'AAPL.US' }, new AbortController().signal);
    expect(search.content[0].text).toContain('regulatory_filing');
    expect(search.content[0].text).toContain('earnings_release');
    const evidence = await tools[1].execute('e', { url: filing, query: 'Net sales' }, new AbortController().signal);
    expect(evidence.content[0].text).toContain('#:~:text=');
    await expect(tools[0].execute('bad', { symbol: 'AAPL.US', limit: 0 }, new AbortController().signal)).rejects.toThrow();
  });
});

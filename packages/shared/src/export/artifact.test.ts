import { describe, expect, it } from 'bun:test';
import { reportToArchive, reportToHtml, reportToJson } from './artifact.ts';
import { redactForShare } from './privacy.ts';
import { reportFixture } from './test-helpers.ts';

describe('research report artifact export', () => {
  const report = reportFixture({
    runManifest: { runId: 'research-run-1', model: 'test-model', configVersion: 'cfg-v1' },
    sections: [{
      key: 'financials', title: 'Financials', verdict: 'positive', summary: 'Revenue grew 18%.',
      evidence: [{
        capabilityId: 'company.financials', runId: 'cap-run-1', claim: 'Revenue grew 18%.',
        fetchedAt: 1_784_000_000_000, instrumentId: 'AAPL.US', metric: 'revenue_growth',
        asOf: 1_783_000_000_000, currency: 'USD', unit: 'percent', status: 'available',
      }, {
        capabilityId: 'research.news', runId: 'cap-run-2', claim: 'Management raised guidance.',
        fetchedAt: 1_784_000_000_000, sourceId: 'src-1', sourceUrl: 'https://example.com/news', provider: 'Example News',
      }],
    }],
  });

  it('exports a machine-readable report → claim → evidence → run chain', () => {
    const archive = reportToArchive(report);
    expect(archive.schemaVersion).toBe('folio-report-export-v1');
    expect(archive.claims[0]?.citationNumbers).toEqual([1, 2]);
    expect(archive.citations[0]?.financial).toMatchObject({ instrumentId: 'AAPL.US', currency: 'USD', unit: 'percent' });
    expect(JSON.parse(reportToJson(report)).runManifest.runId).toBe('research-run-1');
  });

  it('renders self-contained print-ready HTML with stable citations and both evidence kinds', () => {
    const html = reportToHtml(report);
    expect(html).toContain('href="#citation-1"');
    expect(html).toContain('https://example.com/news');
    expect(html).toContain('AAPL.US · revenue_growth · USD · percent');
    expect(html).toContain('@media print');
  });

  it('preserves Markdown tables as semantic HTML tables', () => {
    const html = reportToHtml(reportFixture({
      sections: [{ key: 'metrics', title: 'Metrics', verdict: 'neutral', summary: '| Metric | Value |\n|---|---:|\n| Revenue | $39.3B |', evidence: [] }],
    }));
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Metric</th>');
    expect(html).toContain('<td>$39.3B</td>');
    expect(html).not.toContain('|---|');
  });

  it('redacts secret keys and canary values from every export format', () => {
    const unsafe = reportFixture({
      summary: 'token canary-export-secret-123456 must not escape',
      runManifest: { runId: 'run-1', configVersion: 'v1', authorization: 'Bearer secret' } as never,
    });
    const safe = redactForShare(unsafe);
    const json = reportToJson(safe);
    const html = reportToHtml(safe);
    for (const output of [json, html]) {
      expect(output).not.toContain('canary-export-secret-123456');
      expect(output).not.toContain('Bearer secret');
    }
    expect(json).toContain('<REDACTED>');
    expect(html).toContain('&lt;REDACTED&gt;');
  });

  it('deduplicates repeated evidence and escapes report-controlled HTML', () => {
    const evidence = { capabilityId: 'research.news', runId: 'run-1', claim: '<script>alert(1)</script>', fetchedAt: 1, sourceUrl: 'https://example.com/?a=1&b=2' };
    const unsafe = reportFixture({
      summary: '<img src=x onerror=alert(1)>',
      sections: [
        { key: 'a', title: 'A', verdict: 'neutral', summary: 'One', evidence: [evidence] },
        { key: 'b', title: 'B', verdict: 'neutral', summary: 'Two', evidence: [evidence] },
      ],
    });
    const archive = reportToArchive(unsafe);
    const html = reportToHtml(unsafe);
    expect(archive.citations).toHaveLength(1);
    expect(archive.claims.map((claim) => claim.citationNumbers)).toEqual([[1], [1]]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a=1&amp;b=2');
  });

  it('does not emit active links for non-web citation schemes', () => {
    const html = reportToHtml(reportFixture({
      sections: [{ key: 'unsafe', title: 'Unsafe', verdict: 'neutral', summary: 'No navigation', evidence: [{ capabilityId: 'research.news', runId: 'run-1', claim: 'Bad URL', fetchedAt: 1, sourceUrl: 'javascript:alert(1)', provider: 'Untrusted' }] }],
    }));
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a href=');
  });

  it('strips credential query parameters from citation links', () => {
    const html = reportToHtml(reportFixture({
      sections: [{ key: 'news', title: 'News', verdict: 'neutral', summary: 'Checked', evidence: [{ capabilityId: 'research.news', runId: 'run-1', claim: 'Safe claim', fetchedAt: 1, sourceUrl: 'https://example.com/story?api_key=secret&lang=en', provider: 'Example' }] }],
    }));
    expect(html).toContain('https://example.com/story?lang=en');
    expect(html).not.toContain('api_key');
    expect(html).not.toContain('secret');
  });
});

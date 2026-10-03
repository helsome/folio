/**
 * Reproducible streaming Markdown inputs for #28. A Copilot stream can leave
 * any block in a half-open state for a frame, so these fixtures pin what must
 * keep rendering and what the joined answer must look like once complete.
 */
export interface StreamingMarkdownFixture {
  name: string;
  partial: string;
  complete: string;
  stableText: string;
}

export const STREAMING_MARKDOWN_FIXTURES: StreamingMarkdownFixture[] = [
  {
    name: 'unclosed fenced code block',
    partial: '## Example\n\n```ts\nconst margin = 0.21;\n',
    complete: '## Example\n\n```ts\nconst margin = 0.21;\n```',
    stableText: 'const margin',
  },
  {
    name: 'unclosed GFM table',
    partial: '| Metric | Value |\n| --- | ---: |\n| Revenue | 12,400',
    complete: '| Metric | Value |\n| --- | ---: |\n| Revenue | 12,400 |',
    stableText: '12,400',
  },
  {
    name: 'unclosed ordered list',
    partial: '1. Revenue growth\n2. Operating margin\n3.',
    complete: '1. Revenue growth\n2. Operating margin\n3. Free cash flow',
    stableText: 'Operating margin',
  },
  {
    name: 'unclosed link',
    partial: 'Evidence: [primary source](https://example.com/report',
    complete: 'Evidence: [primary source](https://example.com/report)',
    stableText: 'primary source',
  },
  {
    name: 'unclosed citation marker',
    partial: 'The figure is audited [1',
    complete: 'The figure is audited [1](https://example.com/audit)',
    stableText: 'The figure is audited',
  },
  {
    name: 'trailing blockquote line',
    partial: '> Analyst note: fiscal Q4 beat estimates on\n> revenue and margin',
    complete: '> Analyst note: fiscal Q4 beat estimates on\n> revenue and margin.',
    stableText: 'Analyst note',
  },
];

/**
 * A long agent-style answer with the mix #28 lists: headings, tables, lists,
 * blockquotes, code, links, citation-style references, and hostile HTML/URLs
 * that must never execute or become clickable.
 */
export const LONG_ANSWER_MARKDOWN = `# Quarterly Investment Review

## Market Context

Global equity markets finished the quarter broadly higher as **consolidation**
gave way to a rate-sensitive rally. See [source 1](https://example.com/market)
and [source 2](https://example.com/rates) for the original analysis.

> The portfolio review covers the quarter ended 2025-09-30; all figures are as
> reported by the named provider unless noted otherwise.

## Portfolio Snapshot

| Asset Class | Weight | QoQ Return | Note |
| --- | ---: | ---: | --- |
| Global Equities | 46% | +3.2% | Largest gain from financials |
| US Treasuries | 24% | +0.8% | Duration effect |
| Emerging Markets | 12% | +5.1% | Currency tailwind |
| Commodities | 9% | -1.4% | Energy weakness |
| Cash | 9% | +0.2% | Liquidity buffer |

## Key Findings

1. Revenue exceeded guidance by 4%.
2. Operating margin expanded despite input cost pressure.
3. Free cash flow was converted at 96% of net income.

- Earnings estimates were revised upward after the report.
- Management guided to a similar growth range next quarter.
- Valuation remains below the five-year average on forward earnings.

## Model Output

\`\`\`json
{
  "ticker": "ACME",
  "fcf": 312,
  "margin": 0.21
}
\`\`\`

## Hostile Fragment

<script>alert(1)</script>
<img src="x" onerror="alert(1)">
[Unsafe](javascript:alert(1))
[Phish](//evil.example)

## Evidence

- [audited results](https://example.com/results)
- [provider data](https://example.com/api)

The audited figure [1](https://example.com/audit) and the provider figure
[2](https://example.com/api) are cross-checked above.
`;

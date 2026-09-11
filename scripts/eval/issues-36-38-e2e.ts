import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BackgroundJob, ResearchReport } from '@finagent/core';
import {
  BackgroundJobRepository,
  BackgroundJobScheduler,
  JsonFileStore,
  PortfolioContextRepository,
  redactForShare,
  reportExportBundle,
} from '@finagent/shared';

const generatedAt = Date.now();
const outputDir = join(import.meta.dir, '..', '..', 'artifacts', 'issues-36-38-e2e');

interface DemoSource {
  id: string;
  url: string;
  title: string;
  summary: string;
  publisher: string;
  publishedAt: number;
  available?: boolean;
}

const rawSources: DemoSource[] = [
  {
    id: 'nvidia-ir',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2025?utm_source=folio',
    title: 'NVIDIA Announces Financial Results for Fourth Quarter and Fiscal 2025',
    summary: 'Quarterly revenue was $39.3 billion, up 12% from Q3 and up 78% from a year ago.',
    publisher: 'NVIDIA Newsroom', publishedAt: Date.parse('2025-02-26T21:00:00Z'),
  },
  {
    id: 'nvidia-ir-tracked',
    url: 'https://www.nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2025?utm_campaign=earnings#financial-highlights',
    title: 'NVIDIA Announces Financial Results for Fourth Quarter and Fiscal 2025',
    summary: 'Quarterly revenue was $39.3 billion, up 12% from Q3 and up 78% from a year ago.',
    publisher: 'NVIDIA Newsroom mirror', publishedAt: Date.parse('2025-02-26T21:00:00Z'),
  },
  {
    id: 'sec-submissions', url: 'https://data.sec.gov/submissions/CIK0001045810.json',
    title: 'NVIDIA Corporation SEC submissions', summary: 'Official filing history and accession metadata for NVIDIA Corporation.',
    publisher: 'U.S. SEC', publishedAt: Date.parse('2025-02-26T22:00:00Z'),
  },
  {
    id: 'reuters-original', url: 'https://www.reuters.com/technology/artificial-intelligence/nvidia-forecasts-first-quarter-revenue-above-estimates-2025-02-26/',
    title: 'Nvidia forecasts first-quarter revenue above estimates',
    summary: 'Nvidia forecast quarterly revenue above Wall Street estimates as demand for AI chips remained strong.',
    publisher: 'Reuters', publishedAt: Date.parse('2025-02-26T22:10:00Z'),
  },
  {
    id: 'wire-copy-a', url: 'https://finance.example.test/nvidia-results-copy-a',
    title: 'Nvidia forecasts first quarter revenue above estimates',
    summary: 'Nvidia forecast quarterly revenue above Wall Street estimates as demand for AI chips remained strong.',
    publisher: 'Syndication A', publishedAt: Date.parse('2025-02-26T22:15:00Z'),
  },
  {
    id: 'wire-copy-b', url: 'https://markets.example.test/nvidia-results-copy-b',
    title: 'Nvidia forecasts Q1 revenue above estimates',
    summary: 'Nvidia forecast quarterly revenue above Wall Street estimates as demand for AI chips remained strong.',
    publisher: 'Syndication B', publishedAt: Date.parse('2025-02-26T22:20:00Z'),
  },
];

async function availability(url: string): Promise<{ url: string; status: number | 'unreachable' }> {
  if (url.includes('.example.test')) return { url, status: 'unreachable' };
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Folio-E2E/1.0 research-evidence@example.invalid' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    return { url, status: response.status };
  } catch {
    return { url, status: 'unreachable' };
  }
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const liveAvailability = await Promise.all(rawSources.map((source) => availability(source.url)));
  const availabilityByUrl = new Map(liveAvailability.map((result) => [result.url, typeof result.status === 'number' && result.status < 400]));
  const checkedSources = rawSources.map((source) => ({ ...source, available: availabilityByUrl.get(source.url) ?? source.available }));

  const storeDir = await mkdtemp(join(tmpdir(), 'folio-issues-e2e-'));
  try {
    const store = new JsonFileStore(storeDir);
    const contexts = new PortfolioContextRepository(store, () => generatedAt);
  const instruments = ['NVDA.US', 'AAPL.US', 'MSFT.US', '0700.HK', 'D05.SG'];
  await contexts.saveWatchlist({ id: 'ai-watchlist', name: 'AI and platforms', instruments: instruments.map((instrumentId) => ({ instrumentId })) });
  await contexts.savePortfolio({ id: 'core-portfolio', name: 'Core portfolio', asOf: generatedAt, positions: instruments.map((instrumentId, index) => ({ instrumentId, quantity: 10 + index, nativeCurrency: instrumentId.endsWith('.HK') ? 'HKD' : instrumentId.endsWith('.SG') ? 'SGD' : 'USD' })) });
  const bound = await contexts.bindRun({ runId: 'e2e-copilot-run', sessionId: 'e2e-session', branchId: 'main', selections: [{ kind: 'watchlist', id: 'ai-watchlist' }, { kind: 'portfolio', id: 'core-portfolio' }], relevantInstrumentIds: ['NVDA.US', 'AAPL.US', 'MSFT.US', '0700.HK', 'D05.SG'] });
  await contexts.savePortfolio({ id: 'core-portfolio', name: 'Core portfolio', asOf: generatedAt + 1, positions: [{ instrumentId: 'NVDA.US', quantity: 99, nativeCurrency: 'USD' }] });
  const historical = await contexts.getRunContext('e2e-copilot-run', 'e2e-session', 'main');

  const selected = checkedSources.slice(0, 4);
  const report: ResearchReport = {
    id: 'report-nvda-fy2025-e2e', symbol: 'NVDA.US', generatedAt, strategyId: 'earnings', locale: 'en-US',
    summary: 'NVIDIA reported fiscal Q4 2025 revenue of $39.3B, up 78% year over year. The report keeps the live Web and financial evidence references, including source availability and structured period/currency/unit metadata.',
    stance: 'bullish', confidence: 0.84,
    sections: [{ key: 'research.news', title: 'Earnings event', verdict: 'positive', summary: '| Metric | Value | As of |\n|---|---:|---|\n| Revenue | $39.3B | FY2025 Q4 |\n| YoY growth | 78% | FY2025 Q4 |', evidence: selected.map((source) => ({ capabilityId: 'research.news', runId: 'live-search-e2e', claim: source.title, fetchedAt: generatedAt, summary: source.summary, sourceId: source.id, sourceUrl: source.url, provider: source.publisher, status: source.available ? 'available' : 'unavailable' })) }, { key: 'company.financials', title: 'Financial evidence', verdict: 'positive', summary: 'Quarterly revenue and growth were checked as structured values with explicit unit and period.', evidence: [{ capabilityId: 'company.financials', runId: 'financial-e2e', claim: 'Fiscal Q4 revenue was $39.3B and grew 78% YoY.', fetchedAt: generatedAt, instrumentId: 'NVDA.US', metric: 'quarterly_revenue', asOf: Date.parse('2025-01-26T00:00:00Z'), currency: 'USD', unit: 'billions', status: 'available' }] }],
    bullCase: ['AI accelerator demand remained strong.'], bearCase: ['Supply and customer concentration remain material risks.'], catalysts: ['Blackwell production ramp.'], risks: ['Demand normalization and export controls.'],
    capabilityRuns: [{ runId: 'live-search-e2e', capabilityId: 'research.news', status: 'success', fetchedAt: generatedAt }, { runId: 'financial-e2e', capabilityId: 'company.financials', status: 'success', fetchedAt: generatedAt }],
    runStatus: 'completed',
    runManifest: { runId: 'e2e-copilot-run', model: 'deterministic-e2e', configVersion: 'issues-36-38-v1', contextSnapshotIds: bound.snapshots.map((snapshot) => snapshot.id) },
  };

    const jobs = new BackgroundJobRepository(store);
  const baseJob: BackgroundJob = { id: 'nvda-filing-check', type: 'filing-check', enabled: true, schedule: { intervalMs: 86_400_000 }, input: { symbol: 'NVDA.US' }, targetContext: { kind: 'watchlist', id: 'ai-watchlist' }, createdAt: generatedAt - 1_000, nextRunAt: generatedAt - 1, status: 'scheduled', retryPolicy: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 2 }, missedRunPolicy: 'catch-up', notificationPolicy: { onSuccess: true, onFailure: true, sensitivePreview: false } };
  await jobs.saveJob(baseJob);
  await new BackgroundJobScheduler(jobs, { run: async () => ({ productionRunId: report.id, notificationKind: 'filing-found' }) }, { now: () => generatedAt }).tick();
  await jobs.saveJob({ ...baseJob, id: 'failure-check', nextRunAt: generatedAt - 1 });
  await new BackgroundJobScheduler(jobs, { run: async () => { throw new Error('simulated provider failure'); } }, { now: () => generatedAt, wait: async () => undefined }).tick();

  const bundle = reportExportBundle(redactForShare(report));
  await Promise.all([
    writeFile(join(outputDir, 'nvda-fy2025-report.md'), bundle.markdown),
    writeFile(join(outputDir, 'nvda-fy2025-report.html'), bundle.html),
    writeFile(join(outputDir, 'nvda-fy2025-report.json'), bundle.json),
    writeFile(join(outputDir, 'e2e-evidence.json'), `${JSON.stringify({ generatedAt, liveAvailability, sources: checkedSources, context: { instrumentCount: instruments.length, snapshotIds: bound.snapshots.map((snapshot) => snapshot.id), historicalSnapshotVersion: historical?.snapshots.find((snapshot) => snapshot.kind === 'portfolio')?.sourceVersion, currentPortfolioVersion: (await contexts.listPortfolios())[0]?.version }, background: { jobs: await jobs.listJobs(), runs: await jobs.listRuns(), notifications: await jobs.listNotifications() } }, null, 2)}\n`),
  ]);
    console.log(`E2E artifacts: ${outputDir}`);
    console.log(`raw=${rawSources.length} available=${checkedSources.filter((source) => source.available).length} exported=${selected.length} snapshots=${bound.snapshots.length}`);
  } finally {
    await rm(storeDir, { recursive: true, force: true });
  }
}

await main();

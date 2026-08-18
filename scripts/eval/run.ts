#!/usr/bin/env bun
// Folio eval CLI (spec §70-71, §79).
//
//   bun run eval:smoke  [flags]   # regression+golden subset (~15 cases), CI gate
//   bun run eval:full   [flags]   # entire benchmark dataset
//   bun scripts/eval/run.ts --smoke --mode fixture
//
// Modes:
//   fixture — deterministic local runtime (LocalRuntimeAdapter + canned market
//             data). No LLM credentials, no network, CI-safe (spec §106).
//   live    — real providers via the Pi runtime (credentials from env:
//             ANTHROPIC_API_KEY / FINAGENT_PROVIDER_OVERRIDES).
//
// Exit codes: 0 = gate passed (or no baseline configured) with no infra
// errors; 1 = gate regression, experiment cancelled, or an infra error.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { MarketDataFetchers } from '../../packages/shared/src/agent/market-data-service.ts';
import { MarketDataService } from '../../packages/shared/src/agent/market-data-service.ts';
import { FinanceToolRegistry } from '../../packages/shared/src/agent/finance-tool-registry.ts';
import { AgentKernel } from '../../packages/shared/src/kernel/agent-kernel.ts';
import { createFullRegistry } from '../../packages/shared/src/capabilities/index.ts';
import { JsonFileStore } from '../../packages/shared/src/storage/json-file-store.ts';
import { EvaluationStore } from '../../packages/shared/src/evaluation/store.ts';
import { LocalEvaluationBackend, resolveBackend } from '../../packages/shared/src/evaluation/backend.ts';
import { TraceCorrelationService } from '../../packages/shared/src/evaluation/correlation.ts';
import { createJudgeClient, resolveJudgeConfig } from '../../packages/shared/src/evaluation/judge-client.ts';
import { embeddedDatasets } from '../../packages/shared/src/evaluation/datasets/index.ts';
import { createBaselineFromExperiment, ExperimentService } from '../../packages/shared/src/evaluation/experiment-service.ts';
import type { EvaluationCase, EvaluationDataset, EvaluationExperiment, EvaluationRun, ExperimentConfig } from '../../packages/core/src/index.ts';

// ── CLI flags ──────────────────────────────────────────────────────────────

interface CliOptions {
  smoke: boolean;
  dataset: string;
  mode: 'fixture' | 'live';
  model?: string;
  provider?: string;
  strategy?: string;
  judgeProvider?: string;
  judgeModel?: string;
  judgeApiKey?: string;
  judgeBaseUrl?: string;
  maxCases?: number;
  timeoutMs?: number;
  baseline?: string;
  saveBaseline?: string;
  out?: string;
  storeDir: string;
  help: boolean;
}

const USAGE = `Usage:
  bun run eval:smoke [flags]   # regression+golden subset (~15 cases)
  bun run eval:full  [flags]   # entire benchmark dataset

Flags:
  --dataset <id>          Embedded dataset id (default: folio-agent-v1)
  --mode fixture|live     Runtime mode (default: fixture)
  --model <id>            Agent model under test (e.g. anthropic/claude-sonnet-4-5)
  --provider <id>         Agent provider override
  --strategy <id>         Strategy/skill id to load into the runtime
  --judge-provider <id>   Judge provider (anthropic | openai-compatible)
  --judge-model <id>      Judge model (separate from the agent under test)
  --judge-api-key <key>   Judge API key (or FINAGENT_JUDGE_API_KEY)
  --judge-base-url <url>  Judge endpoint override
  --max-cases <n>         Run only the first n cases (deterministic)
  --timeout-ms <n>        Per-run wall-clock budget (default 120000)
  --baseline <id>         Gate the run against a stored baseline
  --save-baseline <name>  Store the run's aggregates as a new baseline
  --out <path>            Write the full JSON artifact to <path>
  --store <path>          Eval store dir (default ~/.finagent/eval)
  --help                  Show this help

Env: FINAGENT_JUDGE_PROVIDER/FINAGENT_JUDGE_MODEL/FINAGENT_JUDGE_API_KEY,
TRACE_TO_LANGSMITH + LANGSMITH_PI_API_KEY (live tracing), ANTHROPIC_API_KEY or
FINAGENT_PROVIDER_OVERRIDES (live agent), FINAGENT_PI_VERSION.`;

function parseFlags(argv: string[]): CliOptions {
  const options: CliOptions = {
    smoke: false,
    dataset: 'folio-agent-v1',
    mode: 'fixture',
    storeDir: join(homedir(), '.finagent', 'eval'),
    help: false,
  };
  const take = (flag: string, index: number): string | undefined => {
    const inline = argv[index]?.startsWith('=') ? argv[index].slice(1) : undefined;
    if (inline !== undefined) return inline;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Flag ${flag} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const [name, inlineValue] = flag.startsWith('--') ? flag.split('=', 2) : [flag, undefined];
    const value = (positional: string, next: number): string | undefined =>
      inlineValue ?? (positional === name ? take(name, next) : undefined);
    switch (name) {
      case '--help':
        options.help = true;
        break;
      case '--smoke':
        options.smoke = true;
        break;
      case '--dataset': {
        const next = value(name, index);
        if (next !== undefined) {
          options.dataset = next;
          index += 1;
        }
        break;
      }
      case '--mode': {
        const next = value(name, index);
        if (next !== undefined) {
          if (next !== 'fixture' && next !== 'live') throw new Error(`Invalid --mode ${next}; expected fixture|live.`);
          options.mode = next;
          index += 1;
        }
        break;
      }
      case '--model': {
        const next = value(name, index);
        if (next !== undefined) {
          options.model = next;
          index += 1;
        }
        break;
      }
      case '--provider': {
        const next = value(name, index);
        if (next !== undefined) {
          options.provider = next;
          index += 1;
        }
        break;
      }
      case '--strategy': {
        const next = value(name, index);
        if (next !== undefined) {
          options.strategy = next;
          index += 1;
        }
        break;
      }
      case '--judge-provider': {
        const next = value(name, index);
        if (next !== undefined) {
          options.judgeProvider = next;
          index += 1;
        }
        break;
      }
      case '--judge-model': {
        const next = value(name, index);
        if (next !== undefined) {
          options.judgeModel = next;
          index += 1;
        }
        break;
      }
      case '--judge-api-key': {
        const next = value(name, index);
        if (next !== undefined) {
          options.judgeApiKey = next;
          index += 1;
        }
        break;
      }
      case '--judge-base-url': {
        const next = value(name, index);
        if (next !== undefined) {
          options.judgeBaseUrl = next;
          index += 1;
        }
        break;
      }
      case '--max-cases': {
        const next = value(name, index);
        if (next !== undefined) {
          options.maxCases = Number(next);
          if (!Number.isFinite(options.maxCases) || options.maxCases <= 0) {
            throw new Error(`Invalid --max-cases ${next}; expected a positive integer.`);
          }
          index += 1;
        }
        break;
      }
      case '--timeout-ms': {
        const next = value(name, index);
        if (next !== undefined) {
          options.timeoutMs = Number(next);
          if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
            throw new Error(`Invalid --timeout-ms ${next}; expected a positive integer.`);
          }
          index += 1;
        }
        break;
      }
      case '--baseline': {
        const next = value(name, index);
        if (next !== undefined) {
          options.baseline = next;
          index += 1;
        }
        break;
      }
      case '--save-baseline': {
        const next = value(name, index);
        if (next !== undefined) {
          options.saveBaseline = next;
          index += 1;
        }
        break;
      }
      case '--out': {
        const next = value(name, index);
        if (next !== undefined) {
          options.out = next;
          index += 1;
        }
        break;
      }
      case '--store': {
        const next = value(name, index);
        if (next !== undefined) {
          options.storeDir = next;
          index += 1;
        }
        break;
      }
      default:
        throw new Error(`Unknown flag: ${flag}\n\n${USAGE}`);
    }
  }
  return options;
}

// ── Deterministic fixture market data (spec §106) ──────────────────────────

/** Stable per-symbol price seed: same symbol → same price every run. */
function symbolSeed(symbol: string): number {
  let hash = 7;
  for (const char of symbol.toUpperCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function fixturePrice(symbol: string): number {
  return 50 + (symbolSeed(symbol) % 20_000) / 100; // $50.00 – $249.99
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Deterministic fetchers: canned data per symbol; nothing hits the network. */
function createFixtureFetchers(now: () => number): MarketDataFetchers {
  const clock = () => Math.floor(now() / 1000);
  return {
    getQuote: async (symbol) => {
      const price = fixturePrice(symbol);
      const high = +(price * 1.02).toFixed(2);
      const low = +(price * 0.98).toFixed(2);
      const open = +(price * 0.99).toFixed(2);
      return {
        symbol: symbol.toUpperCase(),
        lastPrice: price,
        change: +(price * 0.008).toFixed(2),
        changePercent: 0.8,
        volume: 1_234_567,
        timestamp: clock(),
        high,
        low,
        open,
        prevClose: +(price * 0.99).toFixed(2),
      };
    },
    getKline: async (options) => {
      const symbol = options.symbol.toUpperCase();
      const base = fixturePrice(symbol);
      const count = options.limit ?? 30;
      const periodSeconds = 86_400;
      return Array.from({ length: Math.min(count, 1000) }, (_, index) => {
        const drift = index * 0.002;
        const close = +(base * (1 + drift)).toFixed(2);
        return {
          symbol,
          timestamp: clock() - (count - 1 - index) * periodSeconds,
          open: +(close * 0.995).toFixed(2),
          high: +(close * 1.01).toFixed(2),
          low: +(close * 0.99).toFixed(2),
          close,
          volume: 456_789,
        };
      });
    },
    getIntraday: async (symbol) =>
      Array.from({ length: 60 }, (_, index) => ({
        symbol: symbol.toUpperCase(),
        timestamp: clock() - (59 - index) * 60,
        price: +(fixturePrice(symbol) * (1 + 0.001 * Math.sin(index))).toFixed(2),
        volume: 1_000 + (index % 7) * 100,
      })),
    getMarketStatus: async () => [
      { market: 'US', status: 'TRADING' },
      { market: 'HK', status: 'CLOSED' },
      { market: 'CN', status: 'CLOSED' },
      { market: 'SG', status: 'CLOSED' },
    ],
    getStaticInfo: async (symbol) => ({
      symbol: symbol.toUpperCase(),
      name: `${symbol.toUpperCase()} Corp`,
      exchange: 'NASDAQ',
      currency: 'USD',
      lotSize: 1,
      totalShares: 10_000_000_000,
      circulatingShares: 9_500_000_000,
      eps: 6.5,
      epsTtm: 7.1,
      bps: 24.0,
      dividend: 0.25,
    }),
    getCalcIndex: async (symbol) => ({
      symbol: symbol.toUpperCase(),
      pe: 24.5,
      pb: 6.2,
      dpsRate: 0.5,
      totalMarketValue: 2_500_000_000_000,
      turnoverRate: 1.2,
      ytdChangeRate: 18.4,
      volumeRatio: 1.1,
      amplitude: 2.3,
    }),
    getNews: async (symbol) => [
      {
        id: `news-${symbolSeed(symbol)}-1`,
        title: `${symbol.toUpperCase()} beats quarterly estimates`,
        summary: 'Fixture headline: revenue growth accelerated on strong demand.',
        url: `https://fixture.invalid/news/${symbolSeed(symbol)}/1`,
        timestamp: clock() - 3_600,
        symbols: [symbol.toUpperCase()],
      },
      {
        id: `news-${symbolSeed(symbol)}-2`,
        title: `${symbol.toUpperCase()} announces product expansion`,
        summary: 'Fixture headline: management outlined the next growth phase.',
        url: `https://fixture.invalid/news/${symbolSeed(symbol)}/2`,
        timestamp: clock() - 7_200,
        symbols: [symbol.toUpperCase()],
      },
    ],
    getPortfolio: async () => ({
      baseCurrency: 'USD',
      totalAssets: 100_000,
      cash: 20_000,
      accounts: [{ id: 'acc-1', name: 'Default Account', market: 'US', currency: 'USD', cash: 20_000 }],
      holdings: [
        {
          symbol: 'AAPL.US',
          name: 'Apple',
          currency: 'USD',
          quantity: 10,
          costPrice: 180,
          marketPrice: fixturePrice('AAPL.US'),
          marketValue: 2_000,
          marketValueBase: 2_000,
          unrealizedPnL: 200,
          unrealizedPnLPercent: 11.1,
        },
      ],
      fetchedAt: now(),
    }),
    getDepth: async (symbol) => {
      const price = fixturePrice(symbol);
      const level = (position: number, side: 'b' | 'a'): { position: number; price: number; volume: number; orderNum: number } => ({
        position,
        price: +(price * (side === 'b' ? 1 - 0.001 * position : 1 + 0.001 * position)).toFixed(2),
        volume: 100 * position,
        orderNum: 10 + position,
      });
      return {
        symbol: symbol.toUpperCase(),
        bids: [1, 2, 3, 4, 5].map((position) => level(position, 'b')),
        asks: [1, 2, 3, 4, 5].map((position) => level(position, 'a')),
      };
    },
    getTrades: async (symbol, count = 20) =>
      Array.from({ length: Math.min(count, 100) }, (_, index) => ({
        timestamp: clock() - index * 2,
        price: +(fixturePrice(symbol) * (1 - 0.0002 * index)).toFixed(2),
        volume: 500 + (index % 9) * 100,
        direction: index % 3 === 0 ? 'Up' : index % 3 === 1 ? 'Down' : 'Neutral',
        type: 'I',
      })),
    getCapitalFlow: async (symbol) => ({
      symbol: symbol.toUpperCase(),
      timestamp: clock(),
      capitalIn: { large: 1_000_000, medium: 500_000, small: 250_000 },
      capitalOut: { large: 800_000, medium: 400_000, small: 200_000 },
    }),
    getMarketTemperature: async (market = 'US') => ({
      market,
      temperature: 58,
      description: 'Warm',
      valuation: 62,
      sentiment: 54,
    }),
    getFinancialReport: async (symbol) => {
      const period = 'qf';
      const indicator = (title: string): { title: string; accounts: Array<{ field: string; name: string; values: Array<{ fpEnd: number; period: string; year: number; value: number }> }> } => ({
        title,
        accounts: [
          {
            field: 'Revenue',
            name: 'Revenue',
            values: [{ fpEnd: clock() - 86_400, period: 'Q4 2026', year: 2026, value: 100_000_000_000 }],
          },
          {
            field: 'NetIncome',
            name: 'Net income',
            values: [{ fpEnd: clock() - 86_400, period: 'Q4 2026', year: 2026, value: 25_000_000_000 }],
          },
        ],
      });
      return {
        symbol: symbol.toUpperCase(),
        report: period,
        statements: { IS: { indicators: [indicator('Income statement')] } },
      };
    },
    getInstitutionRating: async (symbol) => ({
      symbol: symbol.toUpperCase(),
      recommend: 'buy',
      target: +(fixturePrice(symbol) * 1.15).toFixed(2),
      updatedAt: clock() - 86_400,
      analyst: {
        distribution: { buy: 24, hold: 8, sell: 2, total: 34 },
        industryName: 'Technology',
      },
    }),
    getDividends: async (symbol) => [
      {
        id: `div-${symbolSeed(symbol)}`,
        description: 'Quarterly dividend 0.25 USD',
        exDate: clock() - 30 * 86_400,
        paymentDate: clock() - 15 * 86_400,
        recordDate: clock() - 25 * 86_400,
        counterId: symbol.toUpperCase(),
      },
    ],
    getEpsForecasts: async () => [
      {
        endDate: clock() + 180 * 86_400,
        startDate: clock(),
        epsMean: 7.4,
        epsMedian: 7.3,
        epsHighest: 8.1,
        epsLowest: 6.8,
        institutionUp: 18,
        institutionDown: 3,
        institutionTotal: 26,
      },
    ],
    getCalendarEvents: async () => [
      {
        id: 'cal-earnings',
        date: clock() + 21 * 86_400,
        type: 'financial',
        activityType: 'earnings',
        symbol: 'AAPL.US',
        name: 'Earnings Release',
        data: [{ type: 'estimate_eps', value: '7.40' }],
      },
    ],
    getAccountPositions: async () => [
      {
        symbol: 'AAPL.US',
        name: 'Apple',
        currency: 'USD',
        quantity: 10,
        costPrice: 180,
        marketPrice: fixturePrice('AAPL.US'),
        marketValue: 2_000,
        marketValueBase: 2_000,
        unrealizedPnL: 200,
        unrealizedPnLPercent: 11.1,
      },
    ],
    getAssets: async () => [
      {
        currency: 'USD',
        netAssets: 100_000,
        totalCash: 20_000,
        buyPower: 40_000,
        cashInfos: [{ currency: 'USD', availableCash: 20_000 }],
      },
    ],
    getCashFlow: async () => [
      {
        currency: 'USD',
        timestamp: clock() - 86_400,
        amount: 5_000,
        flowName: 'Deposit',
        description: 'Fixture cash deposit',
      },
    ],
    getLongBridgeStatus: async () => ({
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    }),
  };
}

// ── Dataset selection ──────────────────────────────────────────────────────

/** Smoke subset (spec §70): all regression cases + golden cases until ~15. */
function selectCases(dataset: EvaluationDataset, smoke: boolean, maxCases: number | undefined): EvaluationCase[] {
  let cases = dataset.cases;
  if (smoke) {
    const regression = dataset.cases.filter((caseItem) => caseItem.difficulty === 'regression');
    const golden = dataset.cases.filter((caseItem) => caseItem.difficulty === 'golden');
    const target = 15;
    const goldenBudget = Math.max(0, target - regression.length);
    cases = [...regression, ...golden.slice(0, goldenBudget)].slice(0, target);
  }
  if (typeof maxCases === 'number' && maxCases > 0) {
    return cases.slice(0, Math.floor(maxCases));
  }
  return cases;
}

// ── Reporting ──────────────────────────────────────────────────────────────

function printCaseTable(
  runs: EvaluationRun[],
  results: Array<{ caseId: string; verdict: string; scores: Array<{ metric: string; score: number | null }> }>,
): void {
  const runByCase = new Map(runs.map((run) => [run.caseId, run]));
  const resultByCase = new Map(results.map((result) => [result.caseId, result]));
  const metrics = ['task_completion', 'tool_recall', 'evidence_presence', 'groundedness'];
  const header =
    'caseId'.padEnd(28) +
    'verdict'.padEnd(10) +
    'status'.padEnd(10) +
    'tools'.padEnd(6) +
    metrics.map((metric) => metric.slice(0, 8).padEnd(9)).join('') +
    'latency';
  console.log(header);
  console.log('-'.repeat(header.length));
  // Sequential runner keeps dataset order: results arrive in run order.
  const ordered = resultByCase.size > 0 ? Array.from(resultByCase.values()) : [];
  for (const result of ordered) {
    const run = runByCase.get(result.caseId);
    const scores = Object.fromEntries(result.scores.map((score) => [score.metric, score.score]));
    const cells = metrics.map((metric) => {
      const score = scores[metric];
      return score === null || score === undefined ? '—'.padEnd(9) : score.toFixed(2).padEnd(9);
    });
    console.log(
      result.caseId.slice(0, 27).padEnd(28) +
        result.verdict.padEnd(10) +
        (run?.status ?? '—').padEnd(10) +
        String(run?.toolCalls.length ?? 0).padEnd(6) +
        cells.join('') +
        (run?.latencyMs !== undefined ? `${run.latencyMs}ms` : '—')
    );
  }
}

function printSummary(experiment: EvaluationExperiment, runs: EvaluationRun[], results: Array<{ verdict: string; failureModes: string[] }>): void {
  const summary = experiment.summary;
  if (!summary) return;
  const passed = results.filter((result) => result.verdict === 'pass').length;
  console.log('');
  console.log(`--- Summary (${experiment.id}) ---`);
  console.log(`passRate: ${summary.passRate.toFixed(2)} (${passed}/${results.length}) · compositeScore: ${summary.compositeScore?.toFixed(3) ?? '—'}`);
  console.log('metric aggregates:');
  for (const aggregate of summary.metricAggregates) {
    const score = aggregate.score === null ? '—' : aggregate.score.toFixed(3);
    console.log(`  ${aggregate.metric.padEnd(24)} ${score.padStart(8)}  (n=${aggregate.sampleCount})`);
  }
  if (summary.failureModes.length > 0) {
    console.log('failure modes:');
    for (const mode of summary.failureModes) {
      console.log(`  ${mode.mode.padEnd(24)} ${String(mode.count).padStart(4)}  (of ${mode.sampleCount} runs)`);
    }
  }
  const infraErrors = runs.filter((run) => run.status === 'failed' && run.error !== undefined);
  if (infraErrors.length > 0) {
    console.log(`infra errors: ${infraErrors.length} run(s) failed at the runtime level`);
  }
}

function printGate(
  experiment: EvaluationExperiment,
  regressions: Array<{ metric: string; baseline: number | null; current: number | null; delta: number | null; maxDelta: number; critical: boolean; passed: boolean }>,
  passed: boolean,
): void {
  console.log('');
  console.log('--- Regression vs baseline ---');
  if (regressions.length === 0) {
    console.log('(no comparable metrics)');
  }
  for (const regression of regressions) {
    if (regression.delta === null) continue;
    const flag = regression.passed ? 'ok' : 'REGRESSION';
    const critical = regression.critical ? ' [critical]' : '';
    console.log(
      `  ${regression.metric.padEnd(22)} ${(regression.baseline ?? 0).toFixed(3)} → ${(regression.current ?? 0).toFixed(3)} (delta ${regression.delta.toFixed(3)}, max ${regression.maxDelta.toFixed(3)}) ${flag}${critical}`
    );
  }
  console.log('');
  if (passed) {
    console.log(`GATE: PASS (${experiment.baselineId ?? 'no baseline'})`);
  } else {
    console.log(`GATE: REGRESSION (${experiment.baselineId ?? 'no baseline'})`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const options = parseFlags(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const datasetEntry = embeddedDatasets.find((entry) => entry.id === options.dataset);
  if (!datasetEntry) {
    console.error(`Dataset not found: ${options.dataset}. Available: ${embeddedDatasets.map((entry) => entry.id).join(', ')}`);
    return 1;
  }
  const dataset = datasetEntry.load();
  const cases = selectCases(dataset, options.smoke, options.maxCases);
  if (cases.length === 0) {
    console.error('No cases selected.');
    return 1;
  }
  console.log(
    `Dataset ${dataset.id}@${dataset.version} (${dataset.cases.length} cases) → running ${cases.length} case(s) in ${options.mode} mode…`
  );

  // Judge: FINAGENT_JUDGE_* env or explicit flags; deterministic-only otherwise.
  const judgeConfig = resolveJudgeConfig(process.env, {
    provider: options.judgeProvider,
    model: options.judgeModel,
    apiKey: options.judgeApiKey,
    baseUrl: options.judgeBaseUrl,
  });
  const judgeClient = judgeConfig ? createJudgeClient(judgeConfig) : undefined;
  if (judgeClient) {
    console.log(`Judge: ${judgeClient.provider}/${judgeClient.model}`);
  } else {
    console.log(
      'No judge configured (set FINAGENT_JUDGE_PROVIDER/FINAGENT_JUDGE_MODEL/FINAGENT_JUDGE_API_KEY) — deterministic evaluators only.'
    );
  }

  // Store + observability backend.
  await mkdir(options.storeDir, { recursive: true });
  const store = new EvaluationStore(new JsonFileStore(options.storeDir));
  const tracingEnabled = process.env.TRACE_TO_LANGSMITH === 'true' || process.env.TRACE_TO_LANGSMITH === '1';
  const backend =
    options.mode === 'fixture'
      ? new LocalEvaluationBackend()
      : resolveBackend(
          {
            tracingEnabled,
            langsmithProject: process.env.LANGSMITH_PI_PROJECT ?? 'folio-agent',
            langsmithEndpoint: process.env.LANGSMITH_PI_ENDPOINT,
          },
          process.env.LANGSMITH_PI_API_KEY ?? process.env.LANGSMITH_API_KEY,
        );

  // Kernel: fixture uses the deterministic local runtime; live uses Pi.
  const runtimeDir = await mkdtemp(join(tmpdir(), 'folio-eval-'));
  let kernel: AgentKernel | undefined;
  try {
    if (options.mode === 'fixture') {
      const marketData = new MarketDataService({ fetchers: createFixtureFetchers(() => Date.now()) });
      const registry = new FinanceToolRegistry(createFullRegistry(marketData));
      kernel = new AgentKernel({
        provider: 'local',
        storageDir: join(runtimeDir, 'store'),
        piSessionDir: join(runtimeDir, 'pi-sessions'),
        marketData,
        registry,
      });
    } else {
      kernel = new AgentKernel({
        provider: 'pi-runtime',
        storageDir: join(runtimeDir, 'store'),
        piSessionDir: join(runtimeDir, 'pi-sessions'),
        rpc: {
          cwd: process.cwd(),
          extensions: [],
          env: () => process.env,
          requestTimeoutMs: options.timeoutMs ?? 120_000,
        },
      });
    }

    const correlation = new TraceCorrelationService({ backend, store });
    const service = new ExperimentService({ store, kernel, backend, correlation });
    const config: ExperimentConfig = {
      mode: options.mode,
      model: options.model,
      provider: options.provider,
      strategyId: options.strategy,
      judgeModel: options.judgeModel ?? judgeConfig?.model,
      judgeProvider: options.judgeProvider ?? judgeConfig?.provider,
      maxCases: options.maxCases,
      timeoutMs: options.timeoutMs,
    };
    // A `--model provider/model` shorthand implies the provider.
    if (config.model && !config.provider && config.model.includes('/')) {
      config.provider = config.model.split('/')[0];
    }

    const experiment = await service.runExperiment({
      dataset: { ...dataset, cases },
      config,
      baselineId: options.baseline,
      judgeClient,
      onProgress: (event) => {
        const mark = event.kind === 'case_started' ? '→' : '✓';
        console.log(`  [${event.index + 1}/${event.total}] ${mark} ${event.caseId}`);
      },
    });

    // Fixture mode: seed the local backend memory so trace lookups resolve.
    const runs = await store.listRuns(experiment.id);
    if (backend instanceof LocalEvaluationBackend) {
      for (const run of runs) {
        if (run.traceRef) {
          backend.recordLocalTrace(
            { backend: 'local', runId: run.id, sessionId: run.traceRef.sessionId, threadId: run.traceRef.threadId },
            run.startedAt,
          );
        }
      }
    }
    const results = await store.listResults(experiment.id);
    printCaseTable(runs, results);
    printSummary(experiment, runs, results);

    // Baseline handling: gate against an existing baseline, optionally store one.
    let regressions: Awaited<ReturnType<ExperimentService['evaluateGate']>>['regressions'] | undefined;
    let gatePassed = true;
    if (options.baseline) {
      const baseline = (await store.listBaselines()).find((entry) => entry.id === options.baseline);
      if (!baseline) {
        console.error(`Baseline not found: ${options.baseline}`);
        return 1;
      }
      if (!experiment.summary) throw new Error('Experiment finished without a summary.');
      const gate = service.evaluateGate(experiment.summary, baseline);
      regressions = gate.regressions;
      gatePassed = gate.passed;
      printGate(experiment, regressions, gatePassed);
    }
    if (options.saveBaseline) {
      const baseline = await createBaselineFromExperiment(store, experiment, options.saveBaseline);
      console.log(`Saved baseline ${baseline.id} (${baseline.name})`);
    }

    if (options.out) {
      await writeFile(
        options.out,
        JSON.stringify(
          { experiment, runs, results, regressions, gatePassed: options.baseline ? gatePassed : undefined },
          null,
          2,
        ),
      );
      console.log(`Artifact written to ${resolve(options.out)}`);
    }

    if (experiment.status === 'cancelled') {
      console.error('Experiment cancelled (aborted).');
      return 1;
    }
    if (options.baseline && !gatePassed) {
      console.error('Regression gate failed — exit 1.');
      return 1;
    }
    return 0;
  } finally {
    await kernel?.dispose();
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const exitCode = await main();
process.exit(exitCode);

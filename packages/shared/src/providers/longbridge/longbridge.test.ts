import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { LongbridgeExec } from './health.ts';
import type { SpawnFn } from './auth.ts';

type ExecaResult = { stdout: string };
type ExecaHandler = (
  command: string,
  args: string[],
  options?: Record<string, unknown>
) => Promise<ExecaResult>;

let execaHandler: ExecaHandler = async () => ({ stdout: '' });
let lastArgs: string[] = [];

const execaMock = mock((command: string, args: string[], options?: Record<string, unknown>) =>
  execaHandler(command, args, options)
);

// `execa` lives at longbridge-tools/node_modules (not hoisted), so the bare
// specifier does not resolve from this package. Mock it at its resolved entry
// so the real longbridge-tools parsers run against canned CLI stdout.
const EXECA_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../longbridge-tools/node_modules/execa/index.js'
);
mock.module(EXECA_ENTRY, () => ({ execa: execaMock }));

// Dynamic import: the execa mock must be registered before the adapter module
// (and its transitive `@finagent/longbridge-tools` execa import) is loaded.
const {
  LongbridgeFinancialDataProvider,
  LongbridgeBrokerAccountProvider,
  LongbridgeHealthProbe,
  logout,
  startLogin,
  testConnection,
} = await import('./index.ts');

beforeEach(() => {
  lastArgs = [];
  execaHandler = async () => ({ stdout: '' });
});

// ── Canned CLI stdout (shapes the longbridge-tools parsers expect) ─────────

const CANNED: Record<string, string> = {
  quote: JSON.stringify([{ symbol: 'NVDA.US', last_price: '224.1', prev_close: '220', change: '4.1', change_ratio: '0.0186', volume: '12345', timestamp: '1786492800', high: '225', low: '219', open: '221' }]),
  kline: JSON.stringify([{ symbol: 'NVDA.US', time: '1786492800', open: '220', high: '225', low: '219', close: '224', volume: '1000' }]),
  intraday: JSON.stringify([{ symbol: 'NVDA.US', timestamp: 1786492800, price: 224, volume: 100 }]),
  depth: JSON.stringify({ symbol: 'NVDA.US', bids: [{ position: 1, price: '224.07', volume: 40 }], asks: [{ position: 1, price: '224.20', volume: 76 }] }),
  trades: JSON.stringify([{ time: '1786492800', price: '224.1', volume: 100, direction: 'Up', type: 'I' }]),
  capital: JSON.stringify({ symbol: 'NVDA.US', timestamp: '1786492800', capital_in: { large: '100', medium: '50', small: '10' }, capital_out: { large: '80', medium: '40', small: '5' } }),
  'market-temp': JSON.stringify([{ field: 'Market', value: 'US' }, { field: 'Temperature', value: '62' }, { field: 'Description', value: 'Comfortable' }, { field: 'Valuation', value: '78' }, { field: 'Sentiment', value: '46' }]),
  'market-status': JSON.stringify([{ market: 'US', status: 'Trading' }]),
  static: JSON.stringify([{ symbol: 'NVDA.US', name: 'NVIDIA', exchange: 'NASD', currency: 'USD', eps: '4.94', eps_ttm: '6.56', bps: '8.04', dividend: '0.28', total_shares: '24300000000', 'circ._shares': '23501828621', lot_size: '1' }]),
  'calc-index': JSON.stringify([{ symbol: 'NVDA.US', pe: '34.12', pb: '27.86', dps_rate: '0.12', total_market_value: '5445387000000', turnover_rate: '0.46' }]),
  'financial-report': JSON.stringify({ symbol: 'NVDA.US', report: 'qf', list: { IS: { indicators: [] } } }),
  dividend: JSON.stringify({ total: 1, list: [{ id: '1', desc: 'dividend', ex_date: '2026-08-01' }] }),
  'forecast-eps': JSON.stringify({ items: [{ forecast_end_date: '1786492800', forecast_eps_mean: '5.0', forecast_eps_median: '5.1', forecast_eps_highest: '6', forecast_eps_lowest: '4', forecast_start_date: '1780000000', institution_up: 10, institution_down: 2, institution_total: 12 }] }),
  'institution-rating': JSON.stringify({ analyst: { evaluate: { buy: 48, hold: 2, sell: 1, strong_buy: 48, over: 10, under: 0, no_opinion: 1, total: 62 }, industry_name: 'semis', target: { highest_price: '500', lowest_price: '180', prev_close: '224.09' } }, instratings: { recommend: 'strong_buy', target: '302.83', ccy_symbol: '$', change: '35.13', evaluate: { buy: 10, hold: 2, sell: 1, strong_buy: 48, under: 0, total: 61 } } }),
  news: JSON.stringify([{ id: '123', title: 'NVIDIA announces', url: 'https://example.com/n', published_at: '1786492800' }]),
  'finance-calendar': JSON.stringify({ date: '2026-08-14', list: [{ date: '2026-08-14', infos: [{ id: '1', datetime: '1786492800', type: 'financial', counter_id: 'ST/US/NVDA', market: 'US', counter_name: 'NVIDIA' }] }] }),
};

const DISPATCH_CASES = [
  { capability: 'market.quote', input: { symbol: 'NVDA.US' }, subcommand: 'quote' },
  { capability: 'market.kline', input: { symbol: 'NVDA.US', period: '1d', count: 5 }, subcommand: 'kline' },
  { capability: 'market.intraday', input: { symbol: 'NVDA.US' }, subcommand: 'intraday' },
  { capability: 'market.depth', input: { symbol: 'NVDA.US' }, subcommand: 'depth' },
  { capability: 'market.trades', input: { symbol: 'NVDA.US', count: 10 }, subcommand: 'trades' },
  { capability: 'market.capitalFlow', input: { symbol: 'NVDA.US' }, subcommand: 'capital' },
  { capability: 'market.sentiment', input: { market: 'US' }, subcommand: 'market-temp' },
  { capability: 'market.status', input: {}, subcommand: 'market-status' },
  { capability: 'company.profile', input: { symbol: 'NVDA.US' }, subcommand: 'static' },
  { capability: 'company.valuation', input: { symbol: 'NVDA.US' }, subcommand: 'calc-index' },
  { capability: 'company.financials', input: { symbol: 'NVDA.US' }, subcommand: 'financial-report' },
  { capability: 'company.dividends', input: { symbol: 'NVDA.US' }, subcommand: 'dividend' },
  { capability: 'company.earnings', input: { symbol: 'NVDA.US' }, subcommand: 'forecast-eps' },
  { capability: 'company.ratings', input: { symbol: 'NVDA.US' }, subcommand: 'institution-rating' },
  { capability: 'research.news', input: { symbol: 'NVDA.US' }, subcommand: 'news' },
  { capability: 'research.events', input: { eventType: 'financial' }, subcommand: 'finance-calendar' },
];

const provider = new LongbridgeFinancialDataProvider();

describe('LongbridgeFinancialDataProvider', () => {
  it('declares identity, capabilities, and markets', () => {
    expect(provider.id).toBe('longbridge');
    expect(provider.name).toBe('Longbridge');
    expect(provider.kind).toBe('financial-data');
    expect(provider.capabilities()).toHaveLength(16);
    expect(provider.markets().map((m) => m.id)).toEqual(['US', 'HK', 'CN', 'SG']);
  });

  for (const { capability, input, subcommand } of DISPATCH_CASES) {
    it(`dispatches ${capability} → ${subcommand}`, async () => {
      execaHandler = async (_command, args) => {
        lastArgs = args;
        return { stdout: CANNED[subcommand] };
      };
      const result = await provider.execute(capability, input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provenance.providerId).toBe('longbridge');
        expect(result.provenance.providerName).toBe('Longbridge');
        expect(result.provenance.stale).toBe(false);
      }
      expect(lastArgs[0]).toBe(subcommand);
    });
  }

  it('passes the symbol through to the CLI', async () => {
    execaHandler = async (_command, args) => {
      lastArgs = args;
      return { stdout: CANNED.quote };
    };
    const result = await provider.execute('market.quote', { symbol: 'NVDA.US' });
    expect(result.ok).toBe(true);
    expect(lastArgs[1]).toBe('NVDA.US');
  });

  it('maps auth failures to AUTH_EXPIRED with a user-safe message', async () => {
    const authError = Object.assign(new Error('not authenticated'), { stderr: 'please login', code: '1' });
    execaHandler = async () => {
      throw authError;
    };
    const result = await provider.execute('market.quote', { symbol: 'NVDA.US' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH_EXPIRED');
      expect(result.error.message).not.toContain('please login');
    }
  });

  it('maps parse failures to PARSE_FAILURE', async () => {
    execaHandler = async () => ({ stdout: 'not json' });
    const result = await provider.execute('market.quote', { symbol: 'NVDA.US' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILURE');
  });

  it('reports UNSUPPORTED_CAPABILITY for an unknown id', async () => {
    const result = await provider.execute('market.nope', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_CAPABILITY');
  });

  it('returns ABORTED for a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await provider.execute('market.quote', { symbol: 'NVDA.US' }, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABORTED');
  });

  it('returns ABORTED when aborted mid-flight', async () => {
    const { promise, resolve } = Promise.withResolvers<ExecaResult>();
    execaHandler = () => promise;
    const controller = new AbortController();
    const pending = provider.execute('market.quote', { symbol: 'NVDA.US' }, controller.signal);
    controller.abort();
    resolve({ stdout: CANNED.quote });
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABORTED');
  });
});

// ── Health probe ────────────────────────────────────────────────────────────

interface HealthExecOverrides {
  version?: () => string | Promise<string>;
  authStatus?: () => string | Promise<string>;
}

function buildExec(overrides: HealthExecOverrides): { exec: LongbridgeExec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: LongbridgeExec = async (args) => {
    calls.push([...args]);
    if (args[0] === '--version') return overrides.version?.() ?? 'longbridge 0.17.0';
    if (args[0] === 'auth') {
      return overrides.authStatus?.() ?? JSON.stringify({ token: { status: '' } });
    }
    throw new Error(`unexpected argv: ${args.join(' ')}`);
  };
  return { exec, calls };
}

const CN_REALTIME_QUOTE_LEVEL =
  'SHAB:OpenAPI|SHAB|Mainland|LV1;SZAD:OpenAPI|SZAD|Mainland|LV1;USAA:OpenAPI|USAA|Global|NBBO;HKAB:OpenAPI|HKAB|Global|LV2';

const DELAYED_QUOTE_LEVEL =
  'SHAB:OpenAPI|SHAB|Mainland|LV1;USAB:OpenAPI|USAB|Global|Delay';

function authJson(quoteLevel: string, tokenStatus = 'valid'): string {
  return JSON.stringify({
    account: { account_no: 'H10643019', name: 'HU HUICHUAN', quote_level: quoteLevel },
    token: { status: tokenStatus },
  });
}

describe('LongbridgeHealthProbe', () => {
  it('reports not-installed when the CLI is missing', async () => {
    const { exec } = buildExec({
      version: () => {
        throw Object.assign(new Error('spawn longbridge ENOENT'), { code: 'ENOENT' });
      },
    });
    const health = await new LongbridgeHealthProbe({ exec, cacheTtlMs: 0 }).status();
    expect(health.status).toBe('not-installed');
  });

  it('reports not-connected when no token is present', async () => {
    const { exec } = buildExec({ authStatus: () => JSON.stringify({ token: { status: '' } }) });
    const health = await new LongbridgeHealthProbe({ exec, cacheTtlMs: 0 }).status();
    expect(health.status).toBe('not-connected');
  });

  it('reports expired when the token is not valid', async () => {
    const { exec } = buildExec({ authStatus: () => authJson(CN_REALTIME_QUOTE_LEVEL, 'expired') });
    const health = await new LongbridgeHealthProbe({ exec, cacheTtlMs: 0 }).status();
    expect(health.status).toBe('expired');
  });

  it('reports connected with permissions and region', async () => {
    const { exec } = buildExec({ authStatus: () => authJson(CN_REALTIME_QUOTE_LEVEL) });
    const health = await new LongbridgeHealthProbe({ exec, cacheTtlMs: 0 }).status();
    expect(health.status).toBe('connected');
    expect(health.account).toBe('HU HUICHUAN');
    expect(health.region).toBe('CN');
    const ids = (health.permissions ?? []).map((p) => p.id).sort();
    expect(ids).toEqual(['CN', 'HK', 'US']);
    expect(health.permissions?.every((p) => p.granted)).toBe(true);
  });

  it('reports permission-limited when a market is delayed-only', async () => {
    const { exec } = buildExec({ authStatus: () => authJson(DELAYED_QUOTE_LEVEL) });
    const health = await new LongbridgeHealthProbe({ exec, cacheTtlMs: 0 }).status();
    expect(health.status).toBe('permission-limited');
    const us = health.permissions?.find((p) => p.id === 'US');
    expect(us?.granted).toBe(true);
    expect(us?.label).toContain('delayed');
  });
});

// ── Broker provider ─────────────────────────────────────────────────────────

const PORTFOLIO_SAMPLE = JSON.stringify({
  overview: {
    total_asset: '50000.00',
    market_cap: '42000.00',
    total_cash: '8000.00',
    total_pl: '1250.50',
    total_today_pl: '-320.10',
    margin_call: '0',
    risk_level: 0,
    credit_limit: '90000.00',
    leverage_ratio: '0',
    fund_market_value: '0',
    currency: 'USD',
  },
  market_accounts: {
    US: { market: 'US', currency: 'USD', net_assets: '35000.00', market_value: '30000.00', pl: '1000.00', today_pl: '-200.00', balance: '5000.00', frozen_cash: '0', withdraw_cash: '5000.00', max_buy_limit: '0' },
    HK: { market: 'HK', currency: 'HKD', net_assets: '15000.00', market_value: '12000.00', pl: '250.50', today_pl: '-120.10', balance: '3000.00', frozen_cash: '0', withdraw_cash: '3000.00', max_buy_limit: '0' },
  },
  cash_balances: [
    { currency: 'USD', total_amount: '5000.00', balance: '5000.00', frozen_cash: '0', withdraw_cash: '5000.00' },
    { currency: 'HKD', total_amount: '3000.00', balance: '3000.00', frozen_cash: '0', withdraw_cash: '3000.00' },
  ],
  holdings: [
    { symbol: '0700.HK', name: '腾讯控股', currency: 'HKD', quantity: '100', available_quantity: '100', cost_price: '400.00', market_value: '38000.00', market_value_usd: '4850.00', market_price: '380.00', prev_close: '385.00' },
    { symbol: 'AAPL.US', name: 'Apple', currency: 'USD', quantity: '10', available_quantity: '10', cost_price: '180.00', market_value: '2000.00', market_value_usd: '2000.00', market_price: '200.00', prev_close: '195.00' },
    { symbol: 'BABA.US', name: 'Alibaba', currency: 'USD', quantity: '20', available_quantity: '20', cost_price: '120.00', market_value: '2000.00', market_value_usd: '2000.00', market_price: '100.00', prev_close: null },
    { symbol: 'DELISTED.US', name: 'Delisted Co', currency: 'USD', quantity: '5', available_quantity: '5', cost_price: '10.00', market_value: '0', market_value_usd: '0', market_price: null, prev_close: null },
  ],
});

describe('LongbridgeBrokerAccountProvider', () => {
  it('declares broker identity', () => {
    const broker = new LongbridgeBrokerAccountProvider();
    expect(broker.id).toBe('longbridge-broker');
    expect(broker.name).toBe('Longbridge Account');
    expect(broker.kind).toBe('broker-account');
  });

  it('derives accounts() from auth status', async () => {
    const exec: LongbridgeExec = async () => authJson(CN_REALTIME_QUOTE_LEVEL);
    const broker = new LongbridgeBrokerAccountProvider({ exec });
    const result = await broker.accounts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { id: 'H10643019', name: 'HU HUICHUAN (H10643019)', region: 'CN' },
      ]);
    }
  });

  it('returns AUTH_EXPIRED from accounts() when not connected', async () => {
    const exec: LongbridgeExec = async () => JSON.stringify({ token: { status: '' } });
    const broker = new LongbridgeBrokerAccountProvider({ exec });
    const result = await broker.accounts();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTH_EXPIRED');
  });

  it('maps getPortfolio to a PortfolioSnapshot', async () => {
    execaHandler = async () => ({ stdout: PORTFOLIO_SAMPLE });
    const broker = new LongbridgeBrokerAccountProvider();
    const result = await broker.getPortfolio();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance.providerId).toBe('longbridge');
      expect(result.data.baseCurrency).toBe('USD');
      expect(result.data.totalAssets).toBe(50000);
      expect(result.data.accounts).toHaveLength(2);
      expect(result.data.holdings).toHaveLength(4);
    }
  });
});

// ── Auth orchestration ──────────────────────────────────────────────────────

describe('auth orchestration', () => {
  it('startLogin opens the verification_uri and completes on a valid token', async () => {
    const spawnedArgs: string[][] = [];
    const opened: string[] = [];
    let killed = false;
    const exec: LongbridgeExec = async () => JSON.stringify({ token: { status: 'valid' } });
    const spawn: SpawnFn = (args, onStdout) => {
      spawnedArgs.push([...args]);
      onStdout(JSON.stringify({ verification_uri: 'https://longbridge.cn/device?code=abc' }));
      return { kill: () => { killed = true; } };
    };
    const outcome = await startLogin({
      exec,
      spawn,
      openUrl: (uri) => { opened.push(uri); },
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(outcome).toEqual({ status: 'connected' });
    expect(opened).toEqual(['https://longbridge.cn/device?code=abc']);
    expect(spawnedArgs).toEqual([['auth', 'login', '--format', 'json']]);
    expect(killed).toBe(true);
  });

  it('startLogin times out when the token never becomes valid', async () => {
    const exec: LongbridgeExec = async () => JSON.stringify({ token: { status: '' } });
    const spawn: SpawnFn = () => ({ kill: () => {} });
    const outcome = await startLogin({ exec, spawn, openUrl: () => {}, pollMs: 1, timeoutMs: 0 });
    expect(outcome).toEqual({ status: 'timeout' });
  });

  it('startLogin cancels on abort', async () => {
    const controller = new AbortController();
    const exec: LongbridgeExec = async () => {
      controller.abort();
      return JSON.stringify({ token: { status: '' } });
    };
    const spawn: SpawnFn = () => ({ kill: () => {} });
    const outcome = await startLogin({
      exec,
      spawn,
      openUrl: () => {},
      pollMs: 1,
      timeoutMs: 1000,
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: 'cancelled' });
  });

  it('logout runs `auth logout`', async () => {
    const calls: string[][] = [];
    const exec: LongbridgeExec = async (args) => {
      calls.push([...args]);
      return '';
    };
    await logout({ exec });
    expect(calls).toEqual([['auth', 'logout']]);
  });

  it('testConnection maps check json to a connected health', async () => {
    const exec: LongbridgeExec = async () =>
      JSON.stringify({
        connectivity: { cn: { ok: true }, global: { ok: false } },
        region: { active: 'CN' },
        session: { token: 'valid' },
      });
    const health = await testConnection({ exec });
    expect(health.status).toBe('connected');
    expect(health.region).toBe('CN');
  });

  it('testConnection reports expired when the session token is invalid', async () => {
    const exec: LongbridgeExec = async () =>
      JSON.stringify({
        connectivity: { cn: { ok: true }, global: { ok: false } },
        region: { active: 'CN' },
        session: { token: 'expired' },
      });
    const health = await testConnection({ exec });
    expect(health.status).toBe('expired');
  });
});

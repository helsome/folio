import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { fixturePath, loadFixture } from './testing/load-fixture.ts';
import { LongBridgeError } from './errors.ts';

// Account-scoped fixtures (positions/assets/cash-flow/portfolio) are captured
// from a real authenticated account and never committed (see .gitignore +
// capture.sh). Skip the tests that need them when they are absent, so a fresh
// clone keeps a green suite; maintainers with a captured account still get the
// coverage.
const hasAccountFixture = (name: string): boolean => existsSync(fixturePath(name));

type ExecaResult = { stdout: string };
type ExecaHandler = (
  command: string,
  args: string[],
  options?: Record<string, unknown>
) => Promise<ExecaResult>;

let execaHandler: ExecaHandler = async () => ({ stdout: '' });

const execaMock = mock((command: string, args: string[], options?: Record<string, unknown>) =>
  execaHandler(command, args, options)
);

mock.module('execa', () => ({ execa: execaMock }));

const {
  getAccountPositions,
  getAssets,
  getCalendarEvents,
  getCapitalFlow,
  getCashFlow,
  getDepth,
  getFinancialReport,
  getMarketTemperature,
  getTrades,


  parseAssetsResponse,
  parseCalendarResponse,
  parseCapitalFlowResponse,
  parseCashFlowResponse,
  parseDepthResponse,
  parseDividendResponse,
  parseEpsForecastResponse,
  parseFinancialReportResponse,
  parseInstitutionRatingResponse,
  parseMarketTemperatureResponse,
  parsePositionsResponse,
  parseTradesResponse,
} = await import('./index');

beforeEach(() => {
  execaHandler = async () => ({ stdout: '' });
  execaMock.mockClear();
});

describe('phase-2 parser normalization', () => {
  it('parses depth fixture', () => {
    const depth = parseDepthResponse(JSON.stringify(loadFixture('depth')));
    expect(depth.symbol).toBe('NVDA.US');
    expect(depth.bids.length).toBeGreaterThan(0);
    expect(depth.asks.length).toBeGreaterThan(0);
    expect(typeof depth.bids[0].price).toBe('number');
    expect(depth.bids[0].position).toBe(1);
  });

  it('parses trades fixture', () => {
    const trades = parseTradesResponse(JSON.stringify(loadFixture('trades')));
    expect(trades.length).toBeGreaterThan(0);
    expect(typeof trades[0].price).toBe('number');
    expect(trades[0].timestamp).toBeGreaterThan(1_600_000_000);
    expect(['Up', 'Down', 'Neutral']).toContain(trades[0].direction);
  });

  it('parses capital snapshot fixture', () => {
    const flow = parseCapitalFlowResponse(JSON.stringify(loadFixture('capital')));
    expect(flow.symbol).toBe('NVDA.US');
    expect(typeof flow.capitalIn.large).toBe('number');
    expect(typeof flow.capitalOut.small).toBe('number');
    expect(flow.timestamp).toBeGreaterThan(1_600_000_000);
  });

  it('parses market-temp fixture into a flat object', () => {
    const temp = parseMarketTemperatureResponse(JSON.stringify(loadFixture('market-temp')));
    expect(temp.market).toBe('US');
    expect(typeof temp.temperature).toBe('number');
    expect(typeof temp.valuation).toBe('number');
    expect(typeof temp.sentiment).toBe('number');
  });

  it('parses financial-report fixture', () => {
    const report = parseFinancialReportResponse(
      JSON.stringify(loadFixture('financial-report')),
      'NVDA.US'
    );
    expect(report.symbol).toBe('NVDA.US');
    expect(report.report).toBe('qf');
    expect(report.statements.BS).toBeDefined();
    expect(report.statements.IS).toBeDefined();
    const first = report.statements.BS!.indicators[0];
    expect(first.accounts.length).toBeGreaterThan(0);
    expect(typeof first.accounts[0].values[0].value).toBe('number');
  });

  it('parses institution-rating fixture', () => {
    const rating = parseInstitutionRatingResponse(
      JSON.stringify(loadFixture('institution-rating')),
      'NVDA.US'
    );
    expect(rating.symbol).toBe('NVDA.US');
    expect(rating.recommend).toBe('strong_buy');
    expect(rating.target).toBeGreaterThan(0);
    expect(rating.analyst).toBeDefined();
    expect(rating.institutional).toBeDefined();
  });

  it('parses dividend fixture', () => {
    const dividends = parseDividendResponse(JSON.stringify(loadFixture('dividend')));
    expect(dividends.length).toBeGreaterThan(0);
    expect(dividends[0].exDate).toBeGreaterThan(1_600_000_000);
    expect(dividends[0].description).toBeTruthy();
  });

  it('parses forecast-eps fixture', () => {
    const forecasts = parseEpsForecastResponse(JSON.stringify(loadFixture('forecast-eps')));
    expect(forecasts.length).toBeGreaterThan(0);
    expect(typeof forecasts[0].epsMean).toBe('number');
    expect(forecasts[0].endDate).toBeGreaterThan(1_700_000_000);
  });

  it('parses calendar-events fixture', () => {
    const events = parseCalendarResponse(JSON.stringify(loadFixture('finance-calendar-events')));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('financial');
    expect(events[0].date).toBeGreaterThan(1_700_000_000);
    expect(events[0].symbol).toBe('NVDA.US');
  });

  it('parses an empty calendar response to an empty array', () => {
    const events = parseCalendarResponse(JSON.stringify(loadFixture('finance-calendar')));
    expect(events).toEqual([]);
  });

  it.skipIf(!hasAccountFixture('positions'))('parses positions fixture', () => {
    const positions = parsePositionsResponse(JSON.stringify(loadFixture('positions')));
    expect(positions.length).toBeGreaterThan(0);
    expect(typeof positions[0].quantity).toBe('number');
    expect(typeof positions[0].costPrice).toBe('number');
    expect(positions[0].symbol).toBeTruthy();
  });

  it.skipIf(!hasAccountFixture('assets'))('parses assets fixture', () => {
    const assets = parseAssetsResponse(JSON.stringify(loadFixture('assets')));
    expect(assets.length).toBeGreaterThan(0);
    expect(typeof assets[0].netAssets).toBe('number');
    expect(assets[0].cashInfos.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasAccountFixture('cash-flow'))('parses cash-flow fixture', () => {
    const flows = parseCashFlowResponse(JSON.stringify(loadFixture('cash-flow')));
    expect(flows.length).toBeGreaterThan(0);
    expect(typeof flows[0].amount).toBe('number');
    expect(flows[0].timestamp).toBeGreaterThan(1_600_000_000);
  });
});

describe('phase-2 argv construction', () => {
  it('getDepth builds argv array without shell interpolation', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('depth')) });
    await getDepth('NVDA.US');
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['depth', 'NVDA.US', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('getTrades passes --count', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('trades')) });
    await getTrades('NVDA.US', 50);
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['trades', 'NVDA.US', '--count', '50', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('getFinancialReport passes --kind and --report', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('financial-report')) });
    await getFinancialReport('NVDA.US', 'IS', 'af');
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['financial-report', 'NVDA.US', '--kind', 'IS', '--report', 'af', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('getMarketTemperature takes a market, not a symbol', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('market-temp')) });
    await getMarketTemperature('HK');
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['market-temp', 'HK', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('getCalendarEvents maps options to argv flags', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('finance-calendar-events')) });
    await getCalendarEvents({
      eventType: 'dividend',
      symbols: ['NVDA.US', 'TSLA.US'],
      start: '2026-01-01',
      count: 10,
    });
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      [
        'finance-calendar',
        'dividend',
        '--symbol',
        'NVDA.US',
        '--symbol',
        'TSLA.US',
        '--start',
        '2026-01-01',
        '--count',
        '10',
        '--format',
        'json',
      ],
      expect.any(Object)
    );
  });

  it.skipIf(!hasAccountFixture('positions'))('getAccountPositions takes no symbol', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('positions')) });
    await getAccountPositions();
    expect(execaMock).toHaveBeenCalledWith('longbridge', ['positions', '--format', 'json'], expect.any(Object));
  });

  it.skipIf(!hasAccountFixture('assets'))('getAssets forwards optional currency', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('assets')) });
    await getAssets('HKD');
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['assets', '--currency', 'HKD', '--format', 'json'],
      expect.any(Object)
    );
  });

  it.skipIf(!hasAccountFixture('cash-flow'))('getCashFlow forwards date range', async () => {
    execaHandler = async () => ({ stdout: JSON.stringify(loadFixture('cash-flow')) });
    await getCashFlow({ start: '2026-01-01', end: '2026-03-31' });
    expect(execaMock).toHaveBeenCalledWith(
      'longbridge',
      ['cash-flow', '--start', '2026-01-01', '--end', '2026-03-31', '--format', 'json'],
      expect.any(Object)
    );
  });
});

describe('phase-2 error handling', () => {
  it('rejects invalid symbols before invoking the CLI', async () => {
    await expect(getDepth('not-a-symbol')).rejects.toMatchObject({ code: 'INVALID_SYMBOL' });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('maps a missing CLI to LONGBRIDGE_NOT_INSTALLED', async () => {
    execaHandler = async () => {
      const error = new Error('spawn longbridge ENOENT') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    };
    await expect(getCapitalFlow('NVDA.US')).rejects.toMatchObject({
      code: 'LONGBRIDGE_NOT_INSTALLED',
    });
  });

  it('maps timeouts to LONGBRIDGE_TIMEOUT', async () => {
    execaHandler = async () => {
      const error = new Error('Command timed out') as Error & { timedOut?: boolean };
      error.timedOut = true;
      throw error;
    };
    await expect(getTrades('NVDA.US')).rejects.toMatchObject({ code: 'LONGBRIDGE_TIMEOUT' });
  });

  it('rejects malformed JSON as a parse failure', () => {
    expect(() => parseDepthResponse('not json')).toThrow(LongBridgeError);
    expect(() => parseDepthResponse('not json')).toThrowError(
      /parse depth response/
    );
  });
});

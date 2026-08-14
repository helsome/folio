import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { LongBridgeError } from './errors.ts';

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

mock.module('execa', () => ({
  execa: execaMock,
}));

const {
  executeLongBridge,
  getLongBridgeStatus,
  getKline,
  getPortfolio,
  getQuote,
  parseQuoteResponse,
} = await import('./index');

const quoteJson = JSON.stringify({
  symbol: 'AAPL.US',
  last_price: 195.5,
  change: 1.25,
  change_ratio: 0.0064,
  volume: 123456,
  timestamp: 1710000000,
  high: 198,
  low: 193,
  open: 194,
  prev_close: 194.25,
});

const longBridgeQuoteArrayJson = JSON.stringify([
  {
    symbol: 'AAPL.US',
    last: '276.830',
    high: '280.630',
    low: '274.860',
    open: '279.655',
    prev_close: '280.140',
    volume: 46668401,
    timestamp: '2026-05-05 12:36:35',
  },
]);

const portfolioJson = JSON.stringify({
  overview: {
    total_asset: '23353.35',
    market_cap: '16309.36',
    total_cash: '7043.99',
    total_pl: '3871.06',
    total_today_pl: '255.33',
    risk_level: 0,
    currency: 'USD',
  },
  market_accounts: {
    US: {
      market: 'US',
      currency: 'USD',
      net_assets: '0',
      market_value: '12273.410',
      pl: '3826.715',
      today_pl: '0',
      balance: '0',
      frozen_cash: '0',
      withdraw_cash: '0',
      max_buy_limit: '0',
    },
  },
  holdings: [
    {
      symbol: 'TSLA.US',
      name: 'Tesla',
      currency: 'USD',
      quantity: '1',
      available_quantity: '1',
      cost_price: '-52.920',
      market_value: '341.510',
      market_value_usd: '341.510',
      market_price: '341.510',
      prev_close: '327.510',
    },
  ],
  cash_balances: [],
});

const klineJson = JSON.stringify([
  {
    symbol: 'AAPL.US',
    timestamp: 1710000000,
    open: 190,
    high: 200,
    low: 180,
    close: 195,
    volume: 12345,
  },
]);

const longBridgeKlineJson = JSON.stringify([
  {
    close: '278.780',
    high: '279.750',
    low: '276.440',
    open: '277.750',
    time: '2025-12-10 05:00:00',
    turnover: '9200505094.000',
    volume: '33038318',
  },
]);

beforeEach(() => {
  execaMock.mockClear();
  execaHandler = async () => ({ stdout: '' });
});

describe('LongBridge command execution', () => {
  it('passes quote command arguments as an execa args array', async () => {
    execaHandler = async () => ({ stdout: quoteJson });

    await getQuote('AAPL.US');

    expect(execaMock).toHaveBeenCalledWith('longbridge', ['quote', 'AAPL.US', '--format', 'json'], {
      timeout: 30000,
    });
  });

  it('passes portfolio command arguments as an execa args array', async () => {
    execaHandler = async () => ({ stdout: portfolioJson });

    await getPortfolio();

    expect(execaMock).toHaveBeenCalledWith('longbridge', ['portfolio', '--format', 'json'], {
      timeout: 30000,
    });
  });

  it('does not pass unsupported limit arguments to the kline command', async () => {
    execaHandler = async () => ({ stdout: klineJson });

    await getKline({ symbol: 'AAPL.US', period: '1d', limit: 5 });

    expect(execaMock).toHaveBeenCalledWith('longbridge', ['kline', 'AAPL.US', '--period', '1d', '--format', 'json'], {
      timeout: 30000,
    });
  });
});

describe('LongBridge errors', () => {
  it('normalizes invalid symbols into LongBridgeError', async () => {
    await expect(getQuote('AAPL; rm -rf /')).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'INVALID_SYMBOL',
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('normalizes not installed failures', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('spawn longbridge ENOENT'), { code: 'ENOENT' });
    };

    await expect(executeLongBridge(['quote', 'AAPL.US'])).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'LONGBRIDGE_NOT_INSTALLED',
    });
  });

  it('normalizes timeout failures', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('timed out'), { timedOut: true });
    };

    await expect(executeLongBridge(['quote', 'AAPL.US'])).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'LONGBRIDGE_TIMEOUT',
    });
  });

  it('normalizes not authenticated failures', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'not authenticated, please login',
      });
    };

    await expect(executeLongBridge(['portfolio', '--format', 'json'])).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'LONGBRIDGE_NOT_AUTHED',
    });
  });

  it('normalizes OAuth authentication failures', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'Authentication failed: OAuth failed: failed to bind callback server on port 60355',
      });
    };

    await expect(executeLongBridge(['quote', 'AAPL.US', '--format', 'json'])).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'LONGBRIDGE_NOT_AUTHED',
    });
  });

  it('normalizes LongBridge rate limit failures', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: 'Error: API error (code 429002): api request is limited, please slow down request frequency',
      });
    };

    await expect(executeLongBridge(['quote', 'AAPL.US', '--format', 'json'])).rejects.toMatchObject({
      name: 'LongBridgeError',
      code: 'LONGBRIDGE_RATE_LIMITED',
    });
  });

  it('normalizes parse failures', () => {
    expect(() => parseQuoteResponse('not json')).toThrow(LongBridgeError);
    try {
      parseQuoteResponse('not json');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'LongBridgeError',
        code: 'LONGBRIDGE_PARSE_FAILURE',
      });
    }
  });
});

describe('LongBridge parsing', () => {
  it('parses LongBridge quote array responses with string prices', () => {
    expect(parseQuoteResponse(longBridgeQuoteArrayJson)).toMatchObject({
      symbol: 'AAPL.US',
      lastPrice: 276.83,
      prevClose: 280.14,
      high: 280.63,
      low: 274.86,
      open: 279.655,
      volume: 46668401,
    });
  });

  it('parses LongBridge kline array responses with string prices', async () => {
    execaHandler = async () => ({ stdout: longBridgeKlineJson });

    await expect(getKline({ symbol: 'AAPL.US', period: '1d', limit: 1 })).resolves.toEqual([
      expect.objectContaining({
        symbol: 'AAPL.US',
        open: 277.75,
        high: 279.75,
        low: 276.44,
        close: 278.78,
        volume: 33038318,
      }),
    ]);
  });
});

describe('LongBridge status', () => {
  it('reports available when the CLI is installed and auth check succeeds', async () => {
    execaHandler = async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'longbridge 1.0.0' };
      if (args[0] === 'quote') return { stdout: longBridgeQuoteArrayJson };
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    };

    await expect(getLongBridgeStatus()).resolves.toEqual({
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    });
    expect(execaMock).toHaveBeenNthCalledWith(1, 'longbridge', ['--version'], { timeout: 5000 });
    expect(execaMock).toHaveBeenNthCalledWith(2, 'longbridge', ['quote', 'AAPL.US', '--format', 'json'], {
      timeout: 5000,
    });
  });

  it('reports not installed without running the auth check', async () => {
    execaHandler = async () => {
      throw Object.assign(new Error('spawn longbridge ENOENT'), { code: 'ENOENT' });
    };

    const status = await getLongBridgeStatus();

    expect(status).toMatchObject({
      installed: false,
      authed: false,
      available: false,
      status: 'not_installed',
      error: { code: 'LONGBRIDGE_NOT_INSTALLED' },
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
  });

  it('reports not authenticated when install check passes but auth check fails', async () => {
    execaHandler = async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'longbridge 1.0.0' };
      throw Object.assign(new Error('Command failed'), {
        stderr: 'auth required',
      });
    };

    await expect(getLongBridgeStatus()).resolves.toMatchObject({
      installed: true,
      authed: false,
      available: false,
      status: 'not_authed',
      error: { code: 'LONGBRIDGE_NOT_AUTHED' },
    });
  });

  it('reports rate limited without suggesting authentication is missing', async () => {
    execaHandler = async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'longbridge 1.0.0' };
      throw Object.assign(new Error('Command failed'), {
        stderr: 'Error: API error (code 429002): api request is limited, please slow down request frequency',
      });
    };

    await expect(getLongBridgeStatus()).resolves.toMatchObject({
      installed: true,
      authed: true,
      available: false,
      status: 'rate_limited',
      error: { code: 'LONGBRIDGE_RATE_LIMITED' },
    });
  });
});

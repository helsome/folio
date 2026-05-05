import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { LongBridgeError } from './errors';

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

const portfolioJson = JSON.stringify({
  total_value: 10000,
  cash: 1500,
  positions: [
    {
      symbol: 'AAPL.US',
      name: 'Apple',
      quantity: 10,
      avg_cost: 180,
      last_price: 195.5,
      market_value: 1955,
      unrealized_pnl: 155,
      unrealized_pnl_ratio: 0.0861,
    },
  ],
});

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

describe('LongBridge status', () => {
  it('reports available when the CLI is installed and auth check succeeds', async () => {
    execaHandler = async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'longbridge 1.0.0' };
      if (args[0] === 'portfolio') return { stdout: portfolioJson };
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    };

    await expect(getLongBridgeStatus()).resolves.toEqual({
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    });
    expect(execaMock).toHaveBeenNthCalledWith(1, 'longbridge', ['--version'], { timeout: 5000 });
    expect(execaMock).toHaveBeenNthCalledWith(2, 'longbridge', ['portfolio', '--format', 'json'], {
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
});

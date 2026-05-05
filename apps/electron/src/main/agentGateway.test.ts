import { beforeEach, describe, expect, it, mock } from 'bun:test';

let lastMarketData: FakeMarketDataService | null = null;
let lastBackendRequest: unknown = null;

class FakeMarketDataService {
  quoteSymbols: string[] = [];

  async getQuote(symbol: string) {
    this.quoteSymbols.push(symbol);
    return { symbol, lastPrice: 200 };
  }

  async getKline(input: unknown) {
    return [{ input }];
  }

  async getPortfolio() {
    return { totalValue: 1000, cash: 100, positions: [] };
  }

  async getLongBridgeStatus() {
    return {
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    };
  }
}

class FakeLocalFinanceAgentBackend {
  private readonly options: { marketData: FakeMarketDataService };

  constructor(options: { marketData: FakeMarketDataService }) {
    this.options = options;
  }

  getTools() {
    return [{ name: 'get_quote', label: 'Get Quote', description: 'Quote', parameters: {} }];
  }

  async send(request: unknown) {
    lastBackendRequest = request;
    return { content: 'ok' };
  }
}

mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp/finagent-test',
  },
}));

mock.module('@finagent/shared', () => ({
  MarketDataService: class extends FakeMarketDataService {
    constructor() {
      super();
      lastMarketData = this;
    }
  },
  LocalFinanceAgentBackend: FakeLocalFinanceAgentBackend,
}));

const { AgentGateway } = await import('./agentGateway.ts');

beforeEach(() => {
  lastMarketData = null;
  lastBackendRequest = null;
});

describe('AgentGateway', () => {
  it('adapts renderer messages to the finance backend request shape', async () => {
    const gateway = new AgentGateway();

    await gateway.send({ sessionId: 's1', content: 'AAPL.US quote' });

    expect(lastBackendRequest).toEqual({
      sessionId: 's1',
      content: 'AAPL.US quote',
    });
  });

  it('routes market quote requests through the shared market data service', async () => {
    const gateway = new AgentGateway();

    await expect(gateway.getQuote('aapl.us')).resolves.toMatchObject({
      symbol: 'AAPL.US',
    });
    expect(lastMarketData?.quoteSymbols).toEqual(['AAPL.US']);
  });
});

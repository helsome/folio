import { describe, expect, it, mock } from 'bun:test';
import { LongBridgeError } from '@finagent/longbridge-tools';
import { MarketDataService } from '../../../../packages/shared/src/agent/market-data-service';
import { runProviderCall } from '../../../../packages/shared/src/providers/longbridge/adapter';
import { ProviderFetchError } from '../../../../packages/shared/src/providers/router-fetchers';
import { portfolioFailureFromError } from '../../../../packages/ui/src/lib/portfolioFailure';
// Only the native host is stubbed; provider normalization and IPC serialization stay real.
mock.module('electron', () => ({ app: {}, Notification: class {}, shell: {}, safeStorage: {} }));
const { toIpcResult } = await import('./kernelHost');

describe('portfolio failure classification across the provider and IPC boundary', () => {
  it.each([
    ['LONGBRIDGE_NOT_INSTALLED', 'LONGBRIDGE_NOT_INSTALLED', 'not-connected'],
    ['LONGBRIDGE_NOT_AUTHED', 'AUTH_EXPIRED', 'no-account-permission'],
    ['LONGBRIDGE_TIMEOUT', 'TIMEOUT', 'timeout'],
    ['LONGBRIDGE_PARSE_FAILURE', 'PARSE_FAILURE', 'parse-error'],
  ] as const)('preserves %s through normalization', async (code, ipcCode, kind) => {
    const service = new MarketDataService({ fetchers: {
      getPortfolio: async () => {
        const result = await runProviderCall(() => {
          throw new LongBridgeError('raw vendor {{{', code);
        });
        if (!result.ok) throw new ProviderFetchError(result.error);
        throw new Error('Expected the provider to fail');
      },
    } });
    const result = await toIpcResult(() => service.getPortfolio());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected an IPC failure');
    expect(result.error.code).toBe(ipcCode);
    expect(result.error.message).not.toContain('raw vendor');
    const failure = portfolioFailureFromError(result.error);
    expect(failure.kind).toBe(kind);
    expect(failure.message).not.toContain('raw vendor');
  });
});

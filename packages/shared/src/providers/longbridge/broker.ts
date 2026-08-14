import type {
  AccountAssets,
  BrokerAccount,
  BrokerAccountProvider,
  CashFlowRecord,
  Holding,
  PortfolioSnapshot,
  ProviderHealth,
  ProviderResult,
} from '@finagent/core';
import {
  executeLongBridge,
  getAccountPositions,
  getAssets,
  getCashFlow,
  getPortfolio,
} from '@finagent/longbridge-tools';
import type { GetCashFlowOptions } from '@finagent/longbridge-tools';
import { isRecord } from '../../guards.ts';
import { longbridgeProvenance, runProviderCall, toProviderError } from './adapter.ts';
import {
  LongbridgeHealthProbe,
  inferRegion,
  parseAuthStatus,
  stringField,
  type LongbridgeExec,
} from './health.ts';

/**
 * Longbridge broker-account provider (spec §5). Portfolio-shaped methods
 * delegate to `@finagent/longbridge-tools`; `accounts()` derives account
 * identity from `longbridge auth status`. Results carry the neutral
 * `@finagent/core` account shapes and Longbridge provenance — no vendor field
 * leaks past this boundary.
 */

export const LONGBRIDGE_BROKER_PROVIDER_ID = 'longbridge-broker';
export const LONGBRIDGE_BROKER_PROVIDER_NAME = 'Longbridge Account';

export interface LongbridgeBrokerAccountProviderOptions {
  exec?: LongbridgeExec;
  probe?: LongbridgeHealthProbe;
}

function asCashFlowOptions(options: unknown): GetCashFlowOptions {
  if (!isRecord(options)) return {};
  const result: GetCashFlowOptions = {};
  const start = stringField(options, 'start');
  const end = stringField(options, 'end');
  if (start) result.start = start;
  if (end) result.end = end;
  return result;
}

export class LongbridgeBrokerAccountProvider implements BrokerAccountProvider {
  readonly kind = 'broker-account' as const;
  readonly id = LONGBRIDGE_BROKER_PROVIDER_ID;
  readonly name = LONGBRIDGE_BROKER_PROVIDER_NAME;

  private readonly exec: LongbridgeExec;
  private readonly probe: LongbridgeHealthProbe;

  constructor(options: LongbridgeBrokerAccountProviderOptions = {}) {
    this.exec = options.exec ?? executeLongBridge;
    this.probe = options.probe ?? new LongbridgeHealthProbe({ exec: this.exec });
  }

  status(): Promise<ProviderHealth> {
    return this.probe.status();
  }

  async accounts(): Promise<ProviderResult<BrokerAccount[]>> {
    let output: string;
    try {
      output = await this.exec(['auth', 'status', '--format', 'json'], { timeout: 10_000 });
    } catch (error) {
      return { ok: false, error: toProviderError(error) };
    }
    const json = parseAuthStatus(output);
    const account = json?.account;
    const accountNo = account?.account_no;
    if (accountNo === undefined || accountNo === '') {
      return { ok: false, error: { code: 'AUTH_EXPIRED', message: 'Longbridge is not connected.' } };
    }
    const no = String(accountNo);
    const name = stringField(account, 'name');
    return {
      ok: true,
      data: [{ id: no, name: name ? `${name} (${no})` : no, region: inferRegion(account) }],
      provenance: longbridgeProvenance(),
    };
  }

  getPortfolio(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<PortfolioSnapshot>> {
    return runProviderCall<PortfolioSnapshot>(() => getPortfolio(), signal);
  }

  getPositions(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<Holding[]>> {
    return runProviderCall<Holding[]>(() => getAccountPositions(), signal);
  }

  getAssets(accountId?: string, signal?: AbortSignal): Promise<ProviderResult<AccountAssets[]>> {
    return runProviderCall<AccountAssets[]>(() => getAssets(), signal);
  }

  getCashFlow(
    accountId?: string,
    options?: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<CashFlowRecord[]>> {
    return runProviderCall<CashFlowRecord[]>(() => getCashFlow(asCashFlowOptions(options)), signal);
  }
}

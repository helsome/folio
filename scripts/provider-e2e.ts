import { writeFile } from 'node:fs/promises'
import { LongbridgeFinancialDataProvider } from '../packages/shared/src/providers/longbridge/index.ts'
import { MassiveFinancialDataProvider } from '../packages/shared/src/providers/massive/index.ts'
import { ProviderRouter } from '../packages/shared/src/providers/router.ts'
import type { Kline, ProviderProvenance, ProviderResult, Quote, StaticInfo } from '../packages/core/src/index.ts'

const ENABLED = process.env.FINAGENT_PROVIDER_E2E === '1'
const SYMBOL = (process.env.FINAGENT_PROVIDER_E2E_SYMBOL ?? 'AAPL.US').trim().toUpperCase()
const OUTPUT = process.env.FINAGENT_PROVIDER_E2E_OUTPUT?.trim()
const CAPABILITIES = ['market.quote', 'market.kline', 'company.profile'] as const

type Capability = (typeof CAPABILITIES)[number]
type Snapshot = {
  providerId: string
  providerName: string
  status: string
  capabilities: Record<Capability, unknown>
  provenance: Record<Capability, ProviderProvenance>
  latencyMs: Record<Capability, number>
}

function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

function fail(message: string): never {
  process.stderr.write(`Provider E2E failed: ${message}\n`)
  process.exit(2)
}

function assertProvenance(
  result: ProviderResult<unknown>,
  providerId: string,
  capability: Capability
): asserts result is Extract<ProviderResult<unknown>, { ok: true }> {
  if (!result.ok) fail(`${providerId} ${capability}: ${result.error.code} (${result.error.message})`)
  const provenance = result.provenance
  if (
    provenance.providerId !== providerId ||
    typeof provenance.providerName !== 'string' ||
    !Number.isFinite(provenance.fetchedAt) ||
    typeof provenance.stale !== 'boolean'
  ) {
    fail(`${providerId} ${capability}: invalid provider provenance`)
  }
}

function assertCanonical(capability: Capability, data: unknown): void {
  if (capability === 'market.quote') {
    const quote = data as Quote
    const fields: Array<keyof Quote> = [
      'symbol',
      'lastPrice',
      'change',
      'changePercent',
      'volume',
      'timestamp',
      'high',
      'low',
      'open',
      'prevClose',
    ]
    if (
      typeof quote !== 'object' ||
      quote === null ||
      fields.some((field) => field === 'symbol' ? typeof quote[field] !== 'string' : !Number.isFinite(quote[field]))
    ) {
      fail(`${capability}: response is not canonical Quote`)
    }
    return
  }
  if (capability === 'market.kline') {
    const klines = data as Kline[]
    if (!Array.isArray(klines) || klines.length === 0) fail(`${capability}: provider returned no bars`)
    for (const bar of klines) {
      if (
        typeof bar.symbol !== 'string' ||
        !Number.isFinite(bar.timestamp) ||
        !Number.isFinite(bar.open) ||
        !Number.isFinite(bar.high) ||
        !Number.isFinite(bar.low) ||
        !Number.isFinite(bar.close) ||
        !Number.isFinite(bar.volume)
      ) {
        fail(`${capability}: response contains a non-canonical bar`)
      }
    }
    return
  }
  const profile = data as StaticInfo
  if (typeof profile !== 'object' || profile === null || typeof profile.symbol !== 'string' || typeof profile.name !== 'string') {
    fail(`${capability}: response is not canonical StaticInfo`)
  }
}

function comparable(capability: Capability, data: unknown): unknown {
  if (capability === 'market.quote') {
    const quote = data as Quote
    return {
      symbol: quote.symbol,
      lastPrice: quote.lastPrice,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      timestamp: quote.timestamp,
      high: quote.high,
      low: quote.low,
      open: quote.open,
      prevClose: quote.prevClose,
    }
  }
  if (capability === 'market.kline') {
    const klines = data as Kline[]
    return { count: klines.length, first: klines[0], last: klines[klines.length - 1] }
  }
  const profile = data as StaticInfo
  return { symbol: profile.symbol, name: profile.name, exchange: profile.exchange, currency: profile.currency }
}

async function executeProvider(
  provider: LongbridgeFinancialDataProvider | MassiveFinancialDataProvider
): Promise<Snapshot> {
  const health = await provider.status()
  if (health.status !== 'connected' && health.status !== 'permission-limited') {
    fail(`${provider.id}: provider status is ${health.status}${health.message ? ` (${health.message})` : ''}`)
  }
  const router = new ProviderRouter()
  router.register(provider)
  router.setRouting({ primary: provider.id })
  const inputs: Record<Capability, unknown> = {
    'market.quote': { symbol: SYMBOL },
    'market.kline': { symbol: SYMBOL, period: '1d', limit: 5 },
    'company.profile': { symbol: SYMBOL },
  }
  const capabilities = {} as Snapshot['capabilities']
  const provenance = {} as Snapshot['provenance']
  const latencyMs = {} as Snapshot['latencyMs']
  for (const capability of CAPABILITIES) {
    const started = performance.now()
    const result = await router.execute(capability, inputs[capability])
    latencyMs[capability] = Math.round(performance.now() - started)
    assertProvenance(result, provider.id, capability)
    assertCanonical(capability, result.data)
    capabilities[capability] = comparable(capability, result.data)
    provenance[capability] = result.provenance
  }
  return { providerId: provider.id, providerName: provider.name, status: health.status, capabilities, provenance, latencyMs }
}

function compare(left: Snapshot, right: Snapshot): Record<Capability, { left: unknown; right: unknown }> {
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, {
    left: left.capabilities[capability],
    right: right.capabilities[capability],
  }])) as Record<Capability, { left: unknown; right: unknown }>
}

async function main(): Promise<void> {
  if (!ENABLED) {
    log('Provider E2E 未运行。设置 FINAGENT_PROVIDER_E2E=1 后才会访问真实 Provider。')
    return
  }
  if (!SYMBOL) fail('FINAGENT_PROVIDER_E2E_SYMBOL 不能为空')
  const apiKey = (process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY)?.trim()
  if (!apiKey) fail('缺少 MASSIVE_API_KEY（或兼容的 POLYGON_API_KEY）')

  const longbridge = new LongbridgeFinancialDataProvider()
  const massive = new MassiveFinancialDataProvider({ getApiKey: async () => apiKey })
  const [longbridgeSnapshot, massiveSnapshot] = await Promise.all([
    executeProvider(longbridge),
    executeProvider(massive),
  ])
  const report = {
    generatedAt: new Date().toISOString(),
    symbol: SYMBOL,
    capabilities: CAPABILITIES,
    providers: [longbridgeSnapshot, massiveSnapshot],
    comparison: compare(longbridgeSnapshot, massiveSnapshot),
  }
  const serialized = JSON.stringify(report, null, 2)
  if (OUTPUT) {
    await writeFile(OUTPUT, `${serialized}\n`, 'utf8')
    log(`Provider E2E 通过；脱敏报告已写入 ${OUTPUT}`)
  } else {
    log(serialized)
    log('Provider E2E 通过；输出仅包含规范化字段和来源元数据。')
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : 'unknown failure'))

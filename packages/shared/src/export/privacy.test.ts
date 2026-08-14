import { describe, expect, it } from 'bun:test'
import { redactForShare } from './index.ts'
import { reportFixture } from './test-helpers.ts'

describe('redactForShare', () => {
  it('leaves a clean report byte-for-byte identical', () => {
    const report = reportFixture()
    expect(JSON.stringify(redactForShare(report))).toBe(JSON.stringify(report))
  })

  it('keeps evidence and all report content', () => {
    const out = redactForShare(reportFixture())
    expect(JSON.stringify(out.sections[0].evidence)).toContain('company.financials')
    expect(out.sections[0].evidence[0].runId).toBe('run_g1')
    expect(out.bullCase).toHaveLength(2)
    expect(out.capabilityRuns).toHaveLength(2)
  })

  it('drops numeric account-like fields at any depth (spec §55)', () => {
    const report = reportFixture() as unknown as Record<string, unknown>
    report.accountValue = 12_345
    report.portfolioSize = '900000'
    report.positions = 42
    report.nested = { positionValue: 999, safeMetric: 7, balance: 0 }
    const out = redactForShare(report as unknown as Parameters<typeof redactForShare>[0]) as unknown as Record<string, unknown>

    expect(out.accountValue).toBeUndefined()
    expect(out.portfolioSize).toBeUndefined()
    expect(out.positions).toBeUndefined()
    const nested = out.nested as Record<string, unknown>
    expect(nested.positionValue).toBeUndefined()
    expect(nested.balance).toBeUndefined()
    expect(nested.safeMetric).toBe(7)
  })

  it('leaves non-account fields and prose untouched', () => {
    const report = reportFixture() as unknown as Record<string, unknown>
    report.marketCap = 3_200_000_000_000
    report.sharesOutstanding = 15_500_000_000
    const out = redactForShare(report as unknown as Parameters<typeof redactForShare>[0]) as unknown as Record<string, unknown>
    expect(out.marketCap).toBe(3_200_000_000_000)
    expect(out.sharesOutstanding).toBe(15_500_000_000)
    expect(out.summary).toBe(reportFixture().summary)
  })
})

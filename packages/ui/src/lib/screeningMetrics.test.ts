import { describe, expect, it } from 'bun:test'
import {
  SCREENING_METRIC_DISPLAY,
  formatScreeningMetric,
  normalizeMetricKey,
  orderedMetricRenders,
} from './screeningMetrics'

describe('normalizeMetricKey', () => {
  it('collapses casing / separator variants to one product key', () => {
    expect(normalizeMetricKey('changePercent')).toBe('changePercent')
    expect(normalizeMetricKey('change_percent')).toBe('changePercent')
    expect(normalizeMetricKey('CHANGEPERCENT')).toBe('changePercent')
    expect(normalizeMetricKey('LastPrice')).toBe('lastPrice')
    expect(normalizeMetricKey('last_price')).toBe('lastPrice')
    expect(normalizeMetricKey('LASTPRICE')).toBe('lastPrice')
  })

  it('returns undefined for unknown / non-string keys', () => {
    expect(normalizeMetricKey('marketCapDollars')).toBeUndefined()
    expect(normalizeMetricKey('')).toBeUndefined()
    expect(normalizeMetricKey('   ')).toBeUndefined()
  })
})

describe('formatScreeningMetric', () => {
  it('formats price to 2 decimals without long floats', () => {
    expect(formatScreeningMetric('lastPrice', 126.3699282931, 'en-US')?.text).toBe('126.37')
    expect(formatScreeningMetric('LASTPRICE', 271.11999999, 'en-US')?.text).toBe('271.12')
  })

  it('formats percent with sign and 1–2 decimals', () => {
    expect(formatScreeningMetric('changePercent', 3.6824877250409163, 'en-US')?.text).toBe('+3.68%')
    expect(formatScreeningMetric('changePercent', -3.4, 'en-US')?.text).toBe('-3.4%')
    expect(formatScreeningMetric('roe', 18.24, 'en-US')?.text).toBe('+18.24%')
    expect(formatScreeningMetric('dividendYield', 3, 'en-US')?.text).toBe('+3%')
  })

  it('formats ratios with a × suffix (1–2 decimals)', () => {
    expect(formatScreeningMetric('pe', 24.6123, 'en-US')?.text).toBe('24.61×')
    expect(formatScreeningMetric('pb', 1.5, 'en-US')?.text).toBe('1.5×')
  })

  it('formats volume with a compact notation', () => {
    expect(formatScreeningMetric('volume', 1200000, 'en-US')?.text).toBe('1.2M')
  })

  it('never leaks undefined / NaN / Infinity / string garbage', () => {
    expect(formatScreeningMetric('lastPrice', undefined, 'en-US')).toBeNull()
    expect(formatScreeningMetric('lastPrice', NaN as unknown as number, 'en-US')).toBeNull()
    expect(formatScreeningMetric('lastPrice', Infinity as unknown as number, 'en-US')).toBeNull()
    expect(formatScreeningMetric('changePercent', 'not-a-number', 'en-US')).toBeNull()
    // unknown metric → hidden entirely
    expect(formatScreeningMetric('marketCapDollars', 12345, 'en-US')).toBeNull()
  })

  it('canonicalises an arbitrary casing variant for an unknown-free result', () => {
    const render = formatScreeningMetric('CHANGE_PERCENT', 3.6824877250409163, 'en-US')
    expect(render?.key).toBe('changePercent')
    expect(render?.text).toBe('+3.68%')
  })
})

describe('orderedMetricRenders', () => {
  it('returns only canonical metrics, formatted, dropping unknown / bad values', () => {
    const renders = orderedMetricRenders(
      {
        changePercent: 3.6824877250409163,
        last_price: 126.3699282931,
        pe: 24.6123,
        volume: 1200000,
        marketCapDollars: 999,
        undefined: undefined,
      },
      'en-US'
    )
    const texts = renders.map((r) => `${r.key}:${r.text}`).sort()
    expect(texts).toEqual(['changePercent:+3.68%', 'lastPrice:126.37', 'pe:24.61×', 'volume:1.2M'])
    expect(texts.join(' ')).not.toContain('marketCapDollars')
    expect(texts.join(' ')).not.toContain('undefined')
    expect(texts.join(' ')).not.toContain('3.6824877250409163')
  })
})

describe('SCREENING_METRIC_DISPLAY', () => {
  it('covers the nine canonical fields with product label keys', () => {
    expect(Object.keys(SCREENING_METRIC_DISPLAY).sort()).toEqual(
      ['changePercent', 'dividendYield', 'lastPrice', 'momentum', 'pb', 'pe', 'revenueGrowth', 'roe', 'volume'].sort()
    )
    for (const spec of Object.values(SCREENING_METRIC_DISPLAY)) {
      expect(typeof spec.labelKey).toBe('string')
    }
  })
})

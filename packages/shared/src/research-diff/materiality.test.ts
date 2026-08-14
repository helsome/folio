import { describe, expect, it } from 'bun:test'
import type { ResearchChange } from '@finagent/core'
import {
  isMaterial,
  MATERIAL_CONFIDENCE_DELTA,
  MATERIAL_PRICE_MOVE_PCT,
} from './materiality.ts'

function change(overrides: Partial<ResearchChange>): ResearchChange {
  return {
    category: 'technical',
    label: 'Price',
    direction: 'improved',
    material: false,
    evidence: [],
    ...overrides,
  }
}

describe('isMaterial', () => {
  it('marks price moves at/above MATERIAL_PRICE_MOVE_PCT as material', () => {
    expect(isMaterial(change({ before: 100, after: 104.9 }))).toBe(false)
    expect(isMaterial(change({ before: 100, after: 105 }))).toBe(true)
    expect(isMaterial(change({ before: 100, after: 95 }))).toBe(true)
    expect(isMaterial(change({ before: 100, after: 95.1 }))).toBe(false)
    expect(MATERIAL_PRICE_MOVE_PCT).toBe(5)
  })

  it('never treats a missing or zero base price as material', () => {
    expect(isMaterial(change({ before: undefined, after: 105 }))).toBe(false)
    expect(isMaterial(change({ before: 0, after: 10 }))).toBe(false)
    expect(isMaterial(change({ before: '100', after: '110' }))).toBe(true)
  })

  it('marks verdict flips (positive ↔ negative) as material', () => {
    expect(
      isMaterial(
        change({
          label: 'Verdict',
          category: 'valuation',
          before: 'positive',
          after: 'negative',
          direction: 'worsened',
        })
      )
    ).toBe(true)
    expect(
      isMaterial(
        change({
          label: 'Verdict',
          category: 'valuation',
          before: 'negative',
          after: 'positive',
          direction: 'improved',
        })
      )
    ).toBe(true)
  })

  it('does not mark non-flip verdict transitions as material', () => {
    expect(
      isMaterial(
        change({
          label: 'Verdict',
          category: 'technical',
          before: 'positive',
          after: 'neutral',
          direction: 'worsened',
        })
      )
    ).toBe(false)
    expect(
      isMaterial(
        change({
          label: 'Verdict',
          category: 'technical',
          before: 'neutral',
          after: 'positive',
          direction: 'improved',
        })
      )
    ).toBe(false)
    expect(
      isMaterial(
        change({
          label: 'Verdict',
          category: 'technical',
          before: 'unavailable',
          after: 'positive',
          direction: 'improved',
        })
      )
    ).toBe(false)
  })

  it('marks rating label changes as material', () => {
    expect(
      isMaterial(
        change({
          label: 'Rating',
          category: 'analyst-rating',
          before: 'Buy',
          after: 'Sell',
          direction: 'worsened',
        })
      )
    ).toBe(true)
    expect(
      isMaterial(
        change({
          label: 'Rating',
          category: 'analyst-rating',
          before: 'Buy',
          after: 'Buy',
          direction: 'unchanged',
        })
      )
    ).toBe(false)
  })

  it('marks confidence deltas at/above MATERIAL_CONFIDENCE_DELTA as material', () => {
    expect(MATERIAL_CONFIDENCE_DELTA).toBe(0.25)
    expect(
      isMaterial(
        change({
          label: 'Confidence',
          category: 'sentiment',
          before: 0.5,
          after: 0.74,
          direction: 'improved',
        })
      )
    ).toBe(false)
    expect(
      isMaterial(
        change({
          label: 'Confidence',
          category: 'sentiment',
          before: 0.5,
          after: 0.75,
          direction: 'improved',
        })
      )
    ).toBe(true)
    expect(
      isMaterial(
        change({
          label: 'Confidence',
          category: 'sentiment',
          before: 0.5,
          after: 0.25,
          direction: 'worsened',
        })
      )
    ).toBe(true)
  })

  it('marks new risks and new earnings sections as material', () => {
    expect(
      isMaterial(
        change({
          category: 'risk',
          label: 'Risk',
          direction: 'new',
          after: 'Regulatory scrutiny',
        })
      )
    ).toBe(true)
    expect(
      isMaterial(
        change({
          category: 'earnings',
          label: 'Section',
          direction: 'new',
          after: 'Earnings',
        })
      )
    ).toBe(true)
    expect(
      isMaterial(
        change({
          category: 'growth',
          label: 'Catalyst',
          direction: 'new',
          after: 'New catalyst',
        })
      )
    ).toBe(false)
    expect(
      isMaterial(
        change({
          category: 'risk',
          label: 'Risk',
          direction: 'removed',
          before: 'Competition',
        })
      )
    ).toBe(false)
  })
})

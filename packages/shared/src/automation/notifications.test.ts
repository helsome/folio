import { describe, expect, it } from 'bun:test'
import type { AutomationRule } from '@finagent/core'
import { formatAutomationNotification } from './notifications.ts'

const RULE: AutomationRule = {
  id: 'rule-1',
  type: 'watchlist-daily-review',
  enabled: true,
  notify: 'material-only',
  createdAt: 1_700_000_000_000,
}

describe('formatAutomationNotification (spec §47, §80)', () => {
  it('returns English title + material body for en-US', () => {
    const { title, body } = formatAutomationNotification(RULE, 'en-US')
    expect(title).toBe('Watchlist daily review triggered')
    expect(body).toContain('Material changes')
  })

  it('returns Chinese title + material body for zh-CN', () => {
    const { title, body } = formatAutomationNotification(RULE, 'zh-CN')
    expect(title).toBe('每日自选回顾 已触发')
    expect(body).toContain('重要变化')
  })

  it('uses the all-changes body when notify is "all"', () => {
    const { body } = formatAutomationNotification({ ...RULE, notify: 'all' }, 'en-US')
    expect(body).toContain('Automated research completed')
  })

  it('reflects the rule type in the title', () => {
    const { title } = formatAutomationNotification(
      { ...RULE, type: 'post-earnings-research' },
      'en-US'
    )
    expect(title).toBe('Post-earnings research triggered')
  })
})

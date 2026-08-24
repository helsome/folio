import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { AutomationRule } from '@finagent/core'
import { useFinagentClient } from '../../client'
import {
  automationStateAtom,
  loadAutomationRulesAtom,
  runRuleAtom,
  toggleAutomationRuleAtom,
} from '../../atoms/automationAtoms'
import { RuleCard } from './RuleCard'
import { AUTOMATION_TYPE_KEYS } from './RuleCard'

/**
 * Settings-style management surface for the five fixed automations (spec
 * §21–25). Mounted in a Today-view drawer from the Daily Brief header;
 * reads/writes rules through the defensive `automation` client channel.
 */
export const AutomationRulesView: React.FC = () => {
  const { t } = useTranslation()
  const client = useFinagentClient()
  const { rules, runs, rulesLoading, error } = useAtomValue(automationStateAtom)
  const loadRules = useSetAtom(loadAutomationRulesAtom)
  const toggleRule = useSetAtom(toggleAutomationRuleAtom)
  const runRule = useSetAtom(runRuleAtom)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')

  useEffect(() => {
    void loadRules(client)
  }, [client, loadRules])

  const handleToggle = (rule: AutomationRule): void => {
    void toggleRule({ client, rule })
  }

  const handleRun = (ruleId: string): void => {
    setRunningId(ruleId)
    void runRule({ client, ruleId }).finally(() => setRunningId(null))
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredRules = rules.filter((rule) => {
    if (statusFilter === 'active' && !rule.enabled) return false
    if (statusFilter === 'paused' && rule.enabled) return false
    if (!normalizedQuery) return true
    return t(AUTOMATION_TYPE_KEYS[rule.type]).toLowerCase().includes(normalizedQuery)
  })

  if (rulesLoading && rules.length === 0) {
    return <div className="rounded-[10px] border border-border bg-surface-raised px-4 py-8 text-[12px] text-foreground/45">{t('automation.loading')}</div>
  }
  if (error !== null && rules.length === 0) {
    return <div className="rounded-[10px] border border-negative/20 bg-negative/5 px-4 py-3 text-[12px] text-negative">{error}</div>
  }
  if (rules.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border bg-surface-raised px-4 py-8 text-[12px] text-foreground/45">
        {t('automation.noRules')}
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="automation-rules-view">
      <div className="rounded-[10px] border border-border bg-surface-raised p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-foreground">{t('today.automation')}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('automation.type.watchlistDailyReview')}
              aria-label={t('automation.type.watchlistDailyReview')}
              className="h-8 w-full rounded-[7px] border border-input bg-surface pl-8 pr-2.5 text-[12px] text-foreground placeholder:text-foreground/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="relative shrink-0">
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" aria-hidden="true" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'paused')}
              aria-label={t('automation.status.active')}
              className="h-8 appearance-none rounded-[7px] border border-input bg-surface py-1 pl-8 pr-7 text-[12px] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All</option>
              <option value="active">{t('automation.status.active')}</option>
              <option value="paused">{t('automation.status.paused')}</option>
            </select>
          </div>
        </div>
      </div>

      {filteredRules.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border bg-surface-raised px-4 py-8 text-center text-[12px] text-foreground/45">
          {t('automation.noRules')}
        </div>
      )}

      {filteredRules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          lastRun={runs.find((run) => run.ruleId === rule.id)}
          running={runningId === rule.id}
          onToggle={handleToggle}
          onRun={handleRun}
        />
      ))}
      <div className="border-t border-border pt-2 text-[11px] leading-relaxed text-foreground/38">
        {t('automation.footer')}
      </div>
    </div>
  )
}

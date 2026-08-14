import React, { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { AutomationRule } from '@finagent/core'
import { useFinagentClient } from '../../client'
import {
  automationStateAtom,
  loadAutomationRulesAtom,
  runRuleAtom,
  toggleAutomationRuleAtom,
} from '../../atoms/automationAtoms'
import { RuleCard } from './RuleCard'

/**
 * Settings-style management surface for the five fixed automations (spec
 * §21–25). Mounted in a Today-view drawer from the Daily Brief header;
 * reads/writes rules through the defensive `automation` client channel.
 */
export const AutomationRulesView: React.FC = () => {
  const client = useFinagentClient()
  const { rules, runs, rulesLoading, error } = useAtomValue(automationStateAtom)
  const loadRules = useSetAtom(loadAutomationRulesAtom)
  const toggleRule = useSetAtom(toggleAutomationRuleAtom)
  const runRule = useSetAtom(runRuleAtom)
  const [runningId, setRunningId] = useState<string | null>(null)

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

  if (rulesLoading && rules.length === 0) {
    return <div className="py-4 text-[13px] text-foreground/42">Loading…</div>
  }
  if (error !== null && rules.length === 0) {
    return <div className="py-4 text-[13px] text-[var(--mac-red)]">{error}</div>
  }
  if (rules.length === 0) {
    return (
      <div className="py-4 text-[13px] text-foreground/42">
        No automation rules yet. The five default rules are seeded by the app on first run.
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="automation-rules-view">
      {rules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          lastRun={runs.find((run) => run.ruleId === rule.id)}
          running={runningId === rule.id}
          onToggle={handleToggle}
          onRun={handleRun}
        />
      ))}
      <div className="pt-1 text-[11px] text-foreground/38">
        Automations run after market close (16:30 local, weekdays) and on earnings
        events. Only material changes trigger deep research.
      </div>
    </div>
  )
}

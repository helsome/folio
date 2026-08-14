import React from 'react'
import type { AutomationRule, AutomationRun } from '@finagent/core'
import { AUTOMATION_TYPE_LABELS, ruleScheduleSummary } from '../../atoms/automationAtoms'

interface RuleCardProps {
  rule: AutomationRule
  lastRun?: AutomationRun
  running: boolean
  onToggle: (rule: AutomationRule) => void
  onRun: (ruleId: string) => void
}

function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** One automation rule card in the management drawer (spec §21–25). */
export const RuleCard: React.FC<RuleCardProps> = ({
  rule,
  lastRun,
  running,
  onToggle,
  onRun,
}) => (
  <div className="rounded-[12px] border border-[oklch(var(--foreground)/0.08)] bg-background/40 p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">
          {AUTOMATION_TYPE_LABELS[rule.type]}
        </div>
        <div className="mt-0.5 text-[12px] text-foreground/54">{ruleScheduleSummary(rule)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            rule.notify === 'material-only'
              ? 'bg-[var(--mac-accent)]/10 text-[var(--mac-accent)]'
              : 'bg-foreground/8 text-foreground/54'
          }`}
        >
          {rule.notify === 'material-only' ? 'Material only' : 'All changes'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${AUTOMATION_TYPE_LABELS[rule.type]} ${rule.enabled ? 'enabled' : 'disabled'}`}
          onClick={() => onToggle(rule)}
          className={`h-5 w-9 rounded-full transition-colors ${
            rule.enabled ? 'bg-[var(--mac-accent)]' : 'bg-foreground/15'
          }`}
        >
          <span
            className={`block h-4 w-4 rounded-full bg-white transition-transform ${
              rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>

    <div className="mt-2 flex items-center justify-between gap-3">
      <div className="text-[11px] text-foreground/38">
        {lastRun !== undefined
          ? `Last run ${formatWhen(lastRun.ranAt)} · ${lastRun.evaluated} evaluated, ${lastRun.materialChanges} material`
          : 'No runs yet'}
      </div>
      <button
        type="button"
        onClick={() => onRun(rule.id)}
        disabled={running || !rule.enabled}
        className="rounded-[8px] border border-[oklch(var(--foreground)/0.12)] px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-[var(--mac-border-strong)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {running ? 'Running…' : 'Run now'}
      </button>
    </div>
  </div>
)

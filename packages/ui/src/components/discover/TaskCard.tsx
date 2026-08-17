import React from 'react'
import type { DiscoverTask } from '../../atoms/discoverAtoms'
import { Button } from '../primitives/Button'

interface TaskCardProps {
  task: DiscoverTask
  running: boolean
  disabled: boolean
  onRun: (task: DiscoverTask) => void
}

/** One discover task: title, description, and a Run button with per-task spinner. */
export const TaskCard: React.FC<TaskCardProps> = ({ task, running, disabled, onRun }) => {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-hover">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{task.title}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-foreground/54">{task.description}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => onRun(task)}
        disabled={disabled}
        aria-busy={running}
        data-testid={`discover-run-${task.id}`}
        className="shrink-0"
      >
        {running && (
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-[var(--mac-border-strong)] border-t-transparent"
          />
        )}
        {running ? 'Running…' : 'Run'}
      </Button>
    </div>
  )
}

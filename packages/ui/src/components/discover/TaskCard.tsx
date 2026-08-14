import React from 'react'
import type { DiscoverTask } from '../../atoms/discoverAtoms'

interface TaskCardProps {
  task: DiscoverTask
  running: boolean
  disabled: boolean
  onRun: (task: DiscoverTask) => void
}

/** One discover task: title, description, and a Run button with per-task spinner. */
export const TaskCard: React.FC<TaskCardProps> = ({ task, running, disabled, onRun }) => {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--mac-border)] bg-background/60 p-3 transition-smooth hover:border-[var(--mac-border-strong)]">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{task.title}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-foreground/54">{task.description}</div>
      </div>
      <button
        type="button"
        onClick={() => onRun(task)}
        disabled={disabled}
        aria-busy={running}
        data-testid={`discover-run-${task.id}`}
        className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--mac-border)] px-3 py-1.5 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running && (
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-[var(--mac-border-strong)] border-t-transparent"
          />
        )}
        {running ? 'Running…' : 'Run'}
      </button>
    </div>
  )
}

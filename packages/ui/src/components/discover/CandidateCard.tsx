import React, { useEffect, useState } from 'react'
import type { ScreeningCandidate } from '@finagent/core'

export type CandidateAction = 'research' | 'compare' | 'watch'

interface CandidateCardProps {
  candidate: ScreeningCandidate
  onAction: (action: CandidateAction, candidate: ScreeningCandidate) => void
}

/** One shortlisted security: symbol, name, score, reason chips, actions. */
export const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, onAction }) => {
  const [watched, setWatched] = useState(false)

  useEffect(() => {
    setWatched(false)
  }, [candidate.symbol])

  const handleWatch = () => {
    onAction('watch', candidate)
    setWatched(true)
  }

  const scoreLabel =
    candidate.score !== undefined ? `${Math.round(candidate.score * 100)}` : 'binary'

  return (
    <div
      data-testid={`candidate-${candidate.symbol}`}
      className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--mac-border)] bg-background/60 p-3 transition-smooth hover:border-[var(--mac-border-strong)]"
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-foreground">{candidate.symbol}</span>
          {candidate.name && candidate.name !== '' && (
            <span className="truncate text-[12px] text-foreground/48">{candidate.name}</span>
          )}
          {candidate.score !== undefined && (
            <span
              data-testid={`candidate-score-${candidate.symbol}`}
              className="rounded-full bg-[var(--mac-blue-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--mac-blue)]"
            >
              {scoreLabel}
            </span>
          )}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {candidate.reasons.map((reason) => (
            <li
              key={reason}
              className="rounded-full border border-[var(--mac-border)] px-2 py-0.5 text-[11px] text-foreground/64"
            >
              {reason}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAction('research', candidate)}
          data-testid={`candidate-research-${candidate.symbol}`}
          className="rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
        >
          Research
        </button>
        <button
          type="button"
          onClick={() => onAction('compare', candidate)}
          data-testid={`candidate-compare-${candidate.symbol}`}
          className="rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
        >
          Compare
        </button>
        <button
          type="button"
          onClick={handleWatch}
          data-testid={`candidate-watch-${candidate.symbol}`}
          className="rounded-[8px] border border-[var(--mac-border)] px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
        >
          {watched ? 'Added' : 'Watch'}
        </button>
      </div>
    </div>
  )
}

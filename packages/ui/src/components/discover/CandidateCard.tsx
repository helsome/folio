import React, { useEffect, useState } from 'react'
import { Bookmark, Check, GitCompareArrows, Search } from 'lucide-react'
import type { ScreeningCandidate } from '@finagent/core'
import { Button } from '../primitives/Button'

export type CandidateAction = 'research' | 'compare' | 'watch'
interface CandidateCardProps { candidate: ScreeningCandidate; onAction: (action: CandidateAction, candidate: ScreeningCandidate) => void }

/** Dense candidate row: the result set reads like a professional list, not a card wall. */
export const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, onAction }) => {
  const [watched, setWatched] = useState(false)
  useEffect(() => setWatched(false), [candidate.symbol])
  const scoreLabel = candidate.score !== undefined ? `${Math.round(candidate.score * 100)}` : '—'
  const metricEntries = Object.entries(candidate.metrics).filter(([, value]) => value !== undefined).slice(0, 2)
  return <div data-testid={`candidate-${candidate.symbol}`} className="grid grid-cols-[minmax(0,1.8fr)_minmax(110px,1fr)_auto] items-center gap-3 border-b border-border px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-hover">
    <div className="min-w-0"><div className="flex items-baseline gap-2"><span className="text-[13px] font-semibold text-foreground">{candidate.symbol}</span><span className="truncate text-[12px] text-foreground/48">{candidate.name}</span></div><div className="mt-1 flex flex-wrap gap-1">{candidate.reasons.slice(0, 3).map((reason) => <span key={reason} className="rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/56">{reason}</span>)}</div></div>
    <div className="flex items-center gap-4 text-right text-[11px] text-foreground/52">{metricEntries.map(([key, value]) => <span key={key}><span className="block text-[10px] uppercase tracking-wide text-foreground/34">{key}</span><span className="tnum font-medium text-foreground/70">{String(value)}</span></span>)}<span><span className="block text-[10px] uppercase tracking-wide text-foreground/34">Score</span><span data-testid={`candidate-score-${candidate.symbol}`} className="tnum font-semibold text-accent">{scoreLabel}</span></span></div>
    <div className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" onClick={() => onAction('research', candidate)} data-testid={`candidate-research-${candidate.symbol}`} aria-label={`Research ${candidate.symbol}`} title="Research"><Search className="h-3.5 w-3.5" /><span className="sr-only">Research</span></Button><Button variant="ghost" size="icon" onClick={() => onAction('compare', candidate)} data-testid={`candidate-compare-${candidate.symbol}`} aria-label={`Compare ${candidate.symbol}`} title="Compare"><GitCompareArrows className="h-3.5 w-3.5" /><span className="sr-only">Compare</span></Button><Button variant="ghost" size="icon" onClick={() => { onAction('watch', candidate); setWatched(true) }} data-testid={`candidate-watch-${candidate.symbol}`} aria-label={`Watch ${candidate.symbol}`} title="Watch">{watched ? <Check className="h-3.5 w-3.5 text-positive" /> : <Bookmark className="h-3.5 w-3.5" />}<span className="sr-only">{watched ? 'Added' : 'Watch'}</span></Button></div>
  </div>
}

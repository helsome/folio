import React from 'react';

/**
 * #30 citation render context. `AnswerContent` computes the message-stable
 * `[n]` numbering once and shares it with inline chips and the typed-block
 * frames. `sourceIds` is the set of ids that actually resolve against the
 * message's evidence records (null when no message context is available, e.g.
 * while streaming) — an id without a backing source renders muted and inert
 * even if it received a syntactic number. `onOpenSource` deep-links a chip
 * into the SourceInspector.
 */
export interface CitationsContextValue {
  numbers: Map<string, number>;
  /** Known source ids; null = no message context (nothing is resolvable). */
  sourceIds: Set<string> | null;
  onOpenSource?: (sourceId: string) => void;
}

export const CitationsContext = React.createContext<CitationsContextValue>({
  numbers: new Map(),
  sourceIds: null,
});

export function useCitations(): CitationsContextValue {
  return React.useContext(CitationsContext);
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCitations } from './citationsContext';

/**
 * One inline citation superscript (`[n]`, #30). A marker is rendered as a
 * numbered, clickable chip only when its id resolves against the message's
 * evidence records; fabricated ids — or evidence still streaming — render as
 * a muted `?` that is never clickable. Provenance is never invented.
 */
export const CitationChip: React.FC<{ sourceId: string }> = ({ sourceId }) => {
  const { t } = useTranslation();
  const { numbers, sourceIds, onOpenSource } = useCitations();
  const resolved = sourceIds !== null && sourceIds.has(sourceId);
  const number = resolved ? numbers.get(sourceId) : undefined;

  if (number === undefined || !onOpenSource) {
    return (
      <sup
        data-citation-id={sourceId}
        data-citation-resolved={resolved ? 'true' : undefined}
        title={t('agent.citation.unresolved')}
        className="mx-0.5 select-none rounded-[3px] bg-foreground/[0.07] px-0.5 font-mono text-[10px] leading-none text-foreground/34"
      >
        {number !== undefined ? number : '?'}
      </sup>
    );
  }

  return (
    <button
      type="button"
      data-citation-id={sourceId}
      data-citation-resolved="true"
      title={t('agent.citation.open')}
      onClick={(event) => {
        event.stopPropagation();
        onOpenSource(sourceId);
      }}
      className="mx-0.5 inline-flex select-none items-baseline rounded-[3px] bg-accent/10 px-1 align-super font-mono text-[10px] leading-none text-accent transition-smooth hover:bg-accent/20"
    >
      {number}
    </button>
  );
};

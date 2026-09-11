import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AnswerBlock } from '@finagent/core';
import { DemoBadge } from '../../primitives/DemoBadge';
import { formatIsoDate } from './blockFormat';

/**
 * Common chrome for every typed answer block: optional heading, the rendered
 * body, and a provenance footer (as-of + evidence references). Evidence ids
 * carry `data-evidence-id` hooks so the #30 source inspector can attach
 * without re-plumbing the block components.
 */
export const AnswerBlockFrame: React.FC<{
  block: AnswerBlock;
  streaming?: boolean;
  /** Right-aligned affordance in the caption row (e.g. the table copy button). */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}> = ({ block, streaming = false, headerAction, children }) => {
  const { t } = useTranslation();
  const evidenceIds = collectEvidenceIds(block);
  const asOf = block.type === 'time_series_chart' ? block.asOf : undefined;
  // Currency display is handled by the value formatters; only the as-of and
  // evidence provenance belong in the footer.
  const showCaption = Boolean(block.title || streaming || headerAction);
  return (
    <figure
      data-block-type={block.type}
      data-block-streaming={streaming || undefined}
      className="my-2 overflow-hidden rounded-[10px] border mac-section-divider bg-surface-muted/55"
    >
      {showCaption && (
        <figcaption className="flex items-center gap-1.5 border-b mac-section-divider px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          <span className="min-w-0 truncate">{block.title ?? t(`agent.blocks.titles.${block.type}`)}</span>
          {streaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-label={t('agent.blocks.loading')} />}
          {headerAction && <span className="ml-auto shrink-0">{headerAction}</span>}
        </figcaption>
      )}
      <div className="px-3 py-2.5">{children}</div>
      {(asOf || block.source || evidenceIds.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t mac-section-divider px-3 py-1.5 text-[10.5px] text-foreground/44">
          {asOf && <span>{t('agent.blocks.asOf', { time: formatIsoDate(asOf) })}</span>}
          {block.source === 'demo' && <DemoBadge />}
          {block.source && block.source !== 'demo' && (
            <span>
              {t('agent.blocks.sourceLabel')}: {block.source}
            </span>
          )}
          {evidenceIds.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              <span className="uppercase tracking-wide">{t('agent.blocks.evidence')}</span>
              {evidenceIds.map((id) => (
                <span
                  key={id}
                  data-evidence-id={id}
                  title={t('agent.blocks.evidenceTip', { id })}
                  className="rounded-[4px] bg-foreground/[0.07] px-1 py-0.5 font-mono text-[10px] text-foreground/62"
                >
                  {id}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </figure>
  );
};

function collectEvidenceIds(block: AnswerBlock): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !ids.includes(value)) ids.push(value);
  };
  for (const id of block.evidenceIds ?? []) push(id);
  if (block.type === 'metric_grid') {
    for (const metric of block.metrics) for (const id of metric.evidenceIds ?? []) push(id);
  }
  return ids;
}

/** Shown while a block fence is still streaming and not yet parseable. */
export const AnswerBlockLoading: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      data-testid="answer-block-loading"
      className="my-2 flex items-center gap-2 rounded-[10px] border border-dashed mac-section-divider px-3 py-3 text-[12px] text-foreground/44"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" />
      {t('agent.blocks.loading')}
    </div>
  );
};

/**
 * Safe degradation for a closed-but-invalid block: a muted text panel instead
 * of the raw payload rendering as a surprise code block — and never a crash
 * of the surrounding message.
 */
export const AnswerBlockInvalid: React.FC<{ body: string }> = ({ body }) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid="answer-block-invalid"
      className="my-2 rounded-[10px] border border-dashed mac-section-divider px-3 py-2.5"
    >
      <div className="text-[11px] font-medium text-foreground/44">{t('agent.blocks.invalid')}</div>
      <div className="mt-1 max-h-24 select-text overflow-hidden whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-foreground/36">
        {body}
      </div>
    </div>
  );
};

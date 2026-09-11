import React, { useMemo } from 'react';
import type { AnswerBlock, Message } from '@finagent/core';
import { CITATION_MARKER_START, parseAnswerBlock, parseCitationSegments } from '@finagent/core';
import { parseAnswerSegments } from './blocks/parseAnswerSegments';
import { AnswerBlockView } from './blocks/AnswerBlockView';
import { MarkdownContent } from './MarkdownContent';
import { CitationChip } from './CitationChip';
import { CitationsContext } from './citationsContext';
import { assignCitationNumbers, collectBlockEvidenceIds, collectCitationSources } from '../../lib/citations';

/**
 * Copilot answer renderer: Markdown text interleaved with typed financial
 * answer blocks (#31) and inline citation markers (#30). Works identically for
 * the live streaming answer and for persisted messages — blocks and markers
 * are part of the message content itself, so a reload rebuilds them from the
 * same bytes. Text segments render through the existing hardened Markdown
 * pipeline (`streaming` coalesces token bursts).
 *
 * When the owning message is provided, citation markers and block evidence ids
 * share one `[n]` numbering space and deep-link into the SourceInspector; a
 * marker without a backing tool call renders muted and inert.
 */
export const AnswerContent: React.FC<{
  content: string;
  streaming?: boolean;
  className?: string;
  /** Owning message, used to resolve citation ids into numbered sources. */
  message?: Message;
  /** Deep-link handler for resolved citations (opens the SourceInspector). */
  onOpenSource?: (sourceId: string) => void;
}> = ({ content, streaming, className = '', message, onOpenSource }) => {
  const segments = useMemo(() => parseAnswerSegments(content), [content]);
  const hasCitations = content.includes(CITATION_MARKER_START);
  const baseClass = `break-words text-[14px] leading-relaxed ${className}`;

  const citations = useMemo(() => {
    if (!hasCitations) return null;
    const sources = message ? collectCitationSources(message) : null;
    const knownIds = sources ? new Set(sources.sources.map((source) => source.id)) : null;
    const inlineOrder: string[] = [];
    for (const segment of segments) {
      if (segment.kind !== 'text') continue;
      for (const part of parseCitationSegments(segment.text)) {
        if (part.kind !== 'citation' || inlineOrder.includes(part.sourceId)) continue;
        // Unknown ids never enter the numbering space — they render muted.
        if (!knownIds || knownIds.has(part.sourceId)) inlineOrder.push(part.sourceId);
      }
    }
    const blocks = segments
      .filter((segment): segment is Extract<typeof segment, { kind: 'block' }> => segment.kind === 'block')
      .flatMap((segment) => parseAnswerBlockBodies(segment.body))
      .map((block) => (knownIds ? filterBlockEvidenceIds(block, knownIds) : block));
    const numbers = assignCitationNumbers(inlineOrder, blocks);
    return { numbers, sources };
  }, [segments, hasCitations, message]);

  const contextValue = useMemo(
    () => ({
      numbers: citations?.numbers ?? new Map<string, number>(),
      sourceIds: citations?.sources ? new Set(citations.sources.sources.map((source) => source.id)) : null,
      ...(onOpenSource && citations?.sources ? { onOpenSource: (sourceId: string) => onOpenSource(sourceId) } : {}),
    }),
    [citations, onOpenSource]
  );

  const renderTextSegment = (text: string, keyPrefix: string): React.ReactNode[] => {
    if (!text.includes(CITATION_MARKER_START)) {
      return [<MarkdownContent key={keyPrefix} content={text} streaming={streaming} />];
    }
    return parseCitationSegments(text).map((part, index) =>
      part.kind === 'text' ? (
        <MarkdownContent key={`${keyPrefix}-${index}`} content={part.text} streaming={streaming} />
      ) : (
        <CitationChip key={`${keyPrefix}-${index}`} sourceId={part.sourceId} />
      )
    );
  };

  if (!citations && segments.every((segment) => segment.kind === 'text')) {
    return <MarkdownContent content={content} streaming={streaming} className={baseClass} />;
  }

  return (
    <CitationsContext.Provider value={contextValue}>
      <div className={`markdown-content ${baseClass}`}>
        {segments.map((segment, index) =>
          segment.kind === 'text' ? (
            <React.Fragment key={index}>{renderTextSegment(segment.text, `t-${index}`)}</React.Fragment>
          ) : (
            <AnswerBlockView key={index} body={segment.body} closed={segment.closed} />
          )
        )}
      </div>
    </CitationsContext.Provider>
  );
};

/** Parse a closed fence body; invalid bodies yield nothing (AnswerBlockView shows its own degradation). */
function parseAnswerBlockBodies(body: string): AnswerBlock[] {
  const result = parseAnswerBlock(body);
  return result.ok && result.block ? [result.block] : [];
}

/** Drop evidence ids that do not resolve against the message's sources. */
function filterBlockEvidenceIds(block: AnswerBlock, knownIds: Set<string>): AnswerBlock {
  const filter = (ids: string[] | undefined) => ids?.filter((id) => knownIds.has(id));
  const filtered = { ...block, evidenceIds: filter(block.evidenceIds) };
  if (block.type === 'metric_grid' && filtered.type === 'metric_grid') {
    return {
      ...filtered,
      metrics: block.metrics.map((metric, index) => ({
        ...metric,
        evidenceIds: filter(block.metrics[index]?.evidenceIds),
      })),
    };
  }
  return filtered;
}

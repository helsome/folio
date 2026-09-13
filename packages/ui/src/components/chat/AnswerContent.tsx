import React, { useMemo } from 'react';
import { parseAnswerSegments } from './blocks/parseAnswerSegments';
import { AnswerBlockView } from './blocks/AnswerBlockView';
import { MarkdownContent } from './MarkdownContent';

/**
 * Copilot answer renderer: Markdown text interleaved with typed financial
 * answer blocks (#31). Works identically for the live streaming answer and for
 * persisted messages — blocks are part of the message content itself, so a
 * reload rebuilds them from the same bytes. Text segments render through the
 * existing hardened Markdown pipeline (`streaming` coalesces token bursts).
 */
export const AnswerContent: React.FC<{
  content: string;
  streaming?: boolean;
  className?: string;
}> = ({ content, streaming, className = '' }) => {
  const segments = useMemo(() => parseAnswerSegments(content), [content]);
  const baseClass = `break-words text-[14px] leading-relaxed ${className}`;

  if (segments.every((segment) => segment.kind === 'text')) {
    return <MarkdownContent content={content} streaming={streaming} className={baseClass} />;
  }

  return (
    <div className={`markdown-content ${baseClass}`}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <MarkdownContent key={index} content={segment.text} streaming={streaming} />
        ) : (
          <AnswerBlockView key={index} body={segment.body} closed={segment.closed} />
        )
      )}
    </div>
  );
};

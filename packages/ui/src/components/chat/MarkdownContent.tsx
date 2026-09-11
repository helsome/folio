import React, { memo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useFinagentClient } from '../../client';
import {
  EMPTY_STREAMING_MARKDOWN,
  updateStreamingMarkdown,
  type StreamingMarkdownSnapshot,
} from './streamingMarkdown';

/**
 * Render agent-authored Markdown without allowing raw HTML to enter the DOM.
 * Agent output is data coming from a runtime, so keeping `rehypeRaw` disabled
 * is intentional. GFM adds the table, task-list, strike-through, and URL
 * behaviours people expect from a research answer.
 */
function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createComponents(openExternal?: (url: string) => void): Components {
  return {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-1 text-[18px] font-bold tracking-tight text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-[15px] font-bold tracking-tight text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[13.5px] font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/45 pl-3 text-foreground/66 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-0 border-t mac-section-divider" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-foreground/55">{children}</del>,
  a: ({ href, children }) => {
    if (!isSafeExternalUrl(href)) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openExternal ? (event) => {
          event.preventDefault();
          openExternal(href);
        } : undefined}
        className="text-accent underline decoration-accent/35 underline-offset-2 hover:decoration-accent"
      >
        {children}
      </a>
    );
  },
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes('language-'));
    return (
      <code
        className={
          isBlock
            ? 'font-mono text-[11.5px] leading-relaxed text-foreground/82'
            : 'rounded-[4px] bg-foreground/[0.07] px-1 py-0.5 font-mono text-[11.5px] text-foreground/82'
        }
        {...props}
      >
        {isBlock ? String(children).replace(/\n$/, '') : children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 max-w-full overflow-x-auto rounded-[8px] border mac-section-divider bg-foreground/[0.045] p-3">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b mac-section-divider px-2 py-1.5 font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b mac-section-divider px-2 py-1.5 align-top text-foreground/75">{children}</td>
  ),
  input: ({ checked, ...props }) => (
    <input {...props} type="checkbox" checked={checked} readOnly className="mr-1.5 accent-accent" />
  ),
  };
}

const MarkdownFragment = memo(function MarkdownFragment({
  content,
  components,
}: {
  content: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
});

function useMarkdownComponents(): Components {
  const client = useFinagentClient();
  const openExternal = client.openExternal;
  const ref = useRef<{ channel: typeof openExternal; components: Components }>();
  if (!ref.current || ref.current.channel !== openExternal) {
    ref.current = {
      channel: openExternal,
      components: createComponents(openExternal ? (url) => void openExternal(url) : undefined),
    };
  }
  return ref.current.components;
}

export const MarkdownContent: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  const components = useMarkdownComponents();
  return (
    <div className={`markdown-content break-words text-[14px] leading-relaxed ${className}`}>
      <MarkdownFragment content={content} components={components} />
    </div>
  );
};

/** Markdown renderer optimized for append-only model output. */
export const StreamingMarkdownContent: React.FC<{ content: string; className?: string }> = ({
  content,
  className = '',
}) => {
  const components = useMarkdownComponents();
  const snapshotRef = useRef<StreamingMarkdownSnapshot>(EMPTY_STREAMING_MARKDOWN);
  snapshotRef.current = updateStreamingMarkdown(snapshotRef.current, content);
  const snapshot = snapshotRef.current;

  return (
    <div className={`markdown-content break-words text-[14px] leading-relaxed ${className}`}>
      {snapshot.chunks.map((chunk, index) => (
        <MarkdownFragment key={index} content={chunk} components={components} />
      ))}
      {snapshot.tail && <MarkdownFragment content={snapshot.tail} components={components} />}
    </div>
  );
};

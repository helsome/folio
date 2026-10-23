import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import { LONG_ANSWER_MARKDOWN, STREAMING_MARKDOWN_FIXTURES } from '../../test/streamingMarkdownFixtures';
import { MarkdownContent } from './MarkdownContent';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/** Mount streamed Markdown and let the 16ms coalescing buffer commit. */
async function mountStreaming(content: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} streaming />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return { container, root };
}

/** Deliver the next delta to an existing streamed root and let it commit. */
async function pushDelta(root: Root, content: string): Promise<void> {
  await act(async () => {
    root.render(<MarkdownContent content={content} streaming />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function mountStatic(content: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<MarkdownContent content={content} />);
  });
  return { container, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function fixtureNamed(name: string): (typeof STREAMING_MARKDOWN_FIXTURES)[number] {
  const fixture = STREAMING_MARKDOWN_FIXTURES.find((entry) => entry.name === name);
  if (!fixture) throw new Error(`Missing streaming fixture: ${name}`);
  return fixture;
}

describe('streaming Markdown fixtures (#28)', () => {
  for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
    it(`keeps "${fixture.name}" renderable while streaming`, async () => {
      const { container, root } = await mountStreaming(fixture.partial);

      expect(container.textContent).toContain(fixture.stableText);
      if (fixture.partialSelector) {
        expect(container.querySelector(fixture.partialSelector)).not.toBeNull();
      }

      await unmount(root);
    });
  }

  it('matches static semantics for every completed fixture', async () => {
    for (const fixture of STREAMING_MARKDOWN_FIXTURES) {
      const { container: streamingContainer, root } = await mountStreaming(fixture.complete);
      const { container: staticContainer, root: staticRoot } = await mountStatic(fixture.complete);

      expect(streamingContainer.textContent).toBe(staticContainer.textContent);

      await unmount(root);
      await unmount(staticRoot);
    }
  });

  it('commits later deltas instead of freezing the first streamed frame', async () => {
    const fixture = fixtureNamed('unclosed ordered list');
    const { container, root } = await mountStreaming(fixture.partial);

    // Intermediate frame: the third item exists but has no text yet.
    const partialItems = container.querySelectorAll('ol li');
    expect(partialItems).toHaveLength(3);
    expect(partialItems[2]?.textContent).toBe('');

    await pushDelta(root, fixture.complete);

    // A stream frozen at its first frame would still show the empty item.
    const completedItems = container.querySelectorAll('ol li');
    expect(completedItems).toHaveLength(3);
    expect(completedItems[2]?.textContent).toBe('Free cash flow');

    await unmount(root);
  });

  it('turns a half-open citation marker into a link when the stream closes it', async () => {
    const fixture = fixtureNamed('unclosed citation marker');
    const { container, root } = await mountStreaming(fixture.partial);

    expect(container.querySelector('a')).toBeNull();

    await pushDelta(root, fixture.complete);

    expect(container.querySelector('a[href="https://example.com/audit"]')?.textContent).toBe('1');

    await unmount(root);
  });

  it('renders the long financial answer without dropping structure', async () => {
    const { container, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);

    expect(container.querySelector('h1')?.textContent).toBe('Quarterly Investment Review');
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(5);
    expect(container.querySelectorAll('li')).toHaveLength(8);
    expect(container.querySelector('blockquote')?.textContent).toContain('portfolio review');
    expect(container.querySelector('pre code')?.textContent).toContain('"fcf": 312');
    expect(container.querySelector('a[href="https://example.com/results"]')?.textContent).toBe('audited results');

    await unmount(root);
  });

  it('keeps raw HTML inert and unsafe URLs out of the streamed DOM', async () => {
    const { container, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);

    // Raw HTML is escaped to text, never becoming live nodes.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    // The hostile paragraph really parses as links, proven by the control
    // link: without it these assertions could pass on text that never became
    // a link in the first place.
    expect(container.querySelector('a[href="https://example.com/safe"]')?.textContent).toBe('Safe');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="//"]')).toBeNull();
    expect(container.textContent).toContain('Unsafe');
    expect(container.textContent).toContain('Phish');

    await unmount(root);
  });

  it('keeps streamed and static long answers semantically identical', async () => {
    const { container: streamingContainer, root } = await mountStreaming(LONG_ANSWER_MARKDOWN);
    const { container: staticContainer, root: staticRoot } = await mountStatic(LONG_ANSWER_MARKDOWN);

    expect(streamingContainer.textContent).toBe(staticContainer.textContent);
    expect(streamingContainer.querySelectorAll('table')).toHaveLength(1);
    expect(streamingContainer.querySelectorAll('a[href^="https://"]')).not.toHaveLength(0);

    await unmount(root);
    await unmount(staticRoot);
  });
});

describe('streamed Markdown block rendering (#28)', () => {
  /**
   * Mount streamed Markdown wrapped in a Profiler that counts commits.
   * Frame waits are deliberately generous (2-3x the 16ms coalescing
   * interval): these tests assert on content and commit counts, not on
   * wall-clock timing, so a loaded machine must not turn them flaky.
   */
  async function mountProfiled(content: string): Promise<{
    container: HTMLDivElement;
    root: Root;
    commits: () => number;
    render: (value: string) => void;
  }> {
    const container = document.createElement('div');
    const root = createRoot(container);
    let commitCount = 0;
    const tree = (value: string) => (
      <React.Profiler id="markdown-content" onRender={() => { commitCount += 1; }}>
        <MarkdownContent content={value} streaming />
      </React.Profiler>
    );
    await act(async () => {
      root.render(tree(content));
    });
    await settle();
    return { container, root, commits: () => commitCount, render: (value) => { root.render(tree(value)); } };
  }

  /** Let the 16ms coalescing buffer commit, with margin for slow machines. */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  /** Fixed-size token deltas, the shape a real stream delivers. */
  function chunkString(value: string, size: number): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += size) {
      chunks.push(value.slice(index, index + size));
    }
    return chunks;
  }

  it('keeps an unclosed fence one code block even with blank lines inside', async () => {
    const fixture = fixtureNamed('fenced code block with internal blank lines');
    const { container, root } = await mountStreaming(fixture.partial);

    // The blank line inside the fence must not become a block boundary, or
    // the tail of the code block would render as a separate paragraph.
    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(container.querySelector('pre code')?.textContent).toContain('margin = 0.21');
    expect(container.querySelector('pre code')?.textContent).toContain('fcf = 312');
    expect(container.querySelector('p')).toBeNull();

    await unmount(root);
  });

  it('keeps an indented code block one pre across an internal blank line', async () => {
    // CommonMark runs an indented code block across blank lines, so the
    // whole-document render shows a single <pre>. A block boundary at the
    // blank line renders the tail as a second <pre> while streaming (#324).
    const content = '    const a = 1;\n\n    const b = 2;';
    const { container, root } = await mountStreaming(content);
    const { container: staticContainer, root: staticRoot } = await mountStatic(content);

    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;\n\nconst b = 2;');
    // The streamed render must stay structurally identical to the static one:
    // same number of code blocks, same code text, same overall text.
    expect(container.querySelectorAll('pre')).toHaveLength(staticContainer.querySelectorAll('pre').length);
    expect(container.querySelector('pre code')?.textContent).toBe(
      staticContainer.querySelector('pre code')?.textContent,
    );
    expect(container.textContent).toBe(staticContainer.textContent);

    await unmount(root);
    await unmount(staticRoot);
  });

  it('keeps a loose list one list across blank lines', async () => {
    const fixture = fixtureNamed('loose list across a blank line');
    const { container, root } = await mountStreaming(fixture.partial);

    expect(container.querySelectorAll('ol')).toHaveLength(1);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);

    await unmount(root);
  });

  it('coalesces a token burst into a single committed frame', async () => {
    const { container, root, commits, render } = await mountProfiled('');
    const before = commits();

    // A whole frame's worth of tokens delivered synchronously: the coalescing
    // buffer must commit once, not once per delta.
    let accumulated = '';
    await act(async () => {
      for (const chunk of chunkString(LONG_ANSWER_MARKDOWN, 40)) {
        accumulated += chunk;
        render(accumulated);
      }
    });
    await settle();

    // One commit for the batched burst, one for the coalesced frame — with
    // headroom for React batching differences across versions. A per-delta
    // pipeline would commit ~40 times here.
    expect(commits() - before).toBeLessThanOrEqual(3);
    // Nothing is lost while coalescing: the completed answer is fully rendered.
    expect(container.textContent).toContain('cross-checked above');

    await unmount(root);
  });

  it('streams a long financial answer in frames, not per token', async () => {
    // Repeatable long-answer fixture in the shape #28 calls out: repeated
    // sections of headings, tables and lists. ~6 KB streamed in 200-char
    // deltas with one frame wait per delta.
    const section =
      '## Section\n\n| Asset | Weight |\n| --- | ---: |\n| Equities | 46% |\n\n- first point\n- second point\n\n';
    const long = section.repeat(60);
    const chunks = chunkString(long, 200);

    const { container, root, commits, render } = await mountProfiled('');
    let accumulated = '';
    for (const chunk of chunks) {
      accumulated += chunk;
      await act(async () => {
        render(accumulated);
      });
      await settle();
    }
    // Final flush so the last delta's frame is committed before asserting.
    await settle();

    expect(container.querySelectorAll('h2')).toHaveLength(60);
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(60);
    expect(container.querySelectorAll('li')).toHaveLength(120);
    expect(container.textContent).toContain('second point');
    // At most two commits per delivered delta (the delta itself plus the
    // coalesced frame it lands in) — never one per character. Completed
    // blocks stay memoized, so only the arriving block is re-parsed.
    expect(commits()).toBeLessThanOrEqual(chunks.length * 2 + 3);

    await unmount(root);
  });
});
